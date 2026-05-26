"""
pytest suite for agent_identity.AgentIdentityClient.

All HTTP calls are intercepted via unittest.mock so no live server is needed.
The mock patches urllib.request.urlopen at the module level where the SDK
imports it, ensuring the patch always lines up with the actual call site.
"""

from __future__ import annotations

import json
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from agent_identity import (
    AgentIdentityClient,
    AgentIdentityError,
    NoCredentialError,
    ValidationError,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_response(body: dict, status: int = 200) -> MagicMock:
    """Build a fake urllib response context-manager."""
    raw = json.dumps(body).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = raw
    mock_resp.status = status
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def _make_http_error(body: dict, code: int):
    """Build a fake urllib.error.HTTPError."""
    import urllib.error
    raw = json.dumps(body).encode()
    err = urllib.error.HTTPError(
        url="http://localhost:3001/api/resolve",
        code=code,
        msg="Error",
        hdrs=None,  # type: ignore[arg-type]
        fp=BytesIO(raw),
    )
    return err


MINIMAL_CTX = {
    "userId": "user-1",
    "resourceId": "kb-1",
    "resourceKind": "personal",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "action": "read",
    "traceId": "trace-001",
    "requestedAt": "2026-05-27T00:00:00+00:00",
}

MINIMAL_MIGRATION = {
    "migrationId": "mig-001",
    "phase": "load",
    "sourceResourceId": "pg-v1",
    "targetResourceId": "pg-v2",
    "userId": "svc-bot",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "traceId": "trace-mig-001",
    "dryRun": False,
}


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestAgentIdentityClientInit(unittest.TestCase):
    def test_trailing_slash_stripped(self):
        client = AgentIdentityClient(base_url="http://localhost:3001/")
        self.assertEqual(client.base_url, "http://localhost:3001")

    def test_default_base_url(self):
        client = AgentIdentityClient()
        self.assertEqual(client.base_url, "http://localhost:3001")

    def test_custom_timeout(self):
        client = AgentIdentityClient(timeout=30)
        self.assertEqual(client.timeout, 30)


class TestResolve(unittest.TestCase):
    def setUp(self):
        self.client = AgentIdentityClient()

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_success(self, mock_urlopen):
        expected = {"ok": True, "resolvedFor": "user-1", "expiresAt": None}
        mock_urlopen.return_value = _make_response(expected)

        result = self.client.resolve(MINIMAL_CTX)

        self.assertEqual(result["resolvedFor"], "user-1")
        self.assertTrue(result["ok"])
        mock_urlopen.assert_called_once()

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_auto_injects_requested_at(self, mock_urlopen):
        """resolve() must add requestedAt when the caller omits it."""
        ctx_without_ts = {k: v for k, v in MINIMAL_CTX.items() if k != "requestedAt"}
        expected = {"ok": True, "resolvedFor": "user-1", "expiresAt": None}
        mock_urlopen.return_value = _make_response(expected)

        self.client.resolve(ctx_without_ts)  # type: ignore[arg-type]

        call_args = mock_urlopen.call_args
        request_obj = call_args[0][0]
        sent_body = json.loads(request_obj.data.decode())
        self.assertIn("requestedAt", sent_body)

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_no_credential_raises(self, mock_urlopen):
        mock_urlopen.side_effect = _make_http_error({"error": "No credential resolved"}, 403)

        with self.assertRaises(NoCredentialError) as cm:
            self.client.resolve(MINIMAL_CTX)

        self.assertEqual(cm.exception.status_code, 403)
        self.assertIn("No credential resolved", str(cm.exception))

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_validation_error_raises(self, mock_urlopen):
        mock_urlopen.side_effect = _make_http_error({"error": "Missing required field: userId"}, 400)

        with self.assertRaises(ValidationError) as cm:
            self.client.resolve(MINIMAL_CTX)

        self.assertEqual(cm.exception.status_code, 400)

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_server_error_raises(self, mock_urlopen):
        mock_urlopen.side_effect = _make_http_error({"error": "Internal server error"}, 500)

        with self.assertRaises(AgentIdentityError) as cm:
            self.client.resolve(MINIMAL_CTX)

        self.assertEqual(cm.exception.status_code, 500)

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_network_failure_raises(self, mock_urlopen):
        import urllib.error
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

        with self.assertRaises(AgentIdentityError) as cm:
            self.client.resolve(MINIMAL_CTX)

        self.assertIsNone(cm.exception.status_code)

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_returns_expires_at(self, mock_urlopen):
        expected = {
            "ok": True,
            "resolvedFor": "user-1",
            "expiresAt": "2026-05-27T01:00:00+00:00",
        }
        mock_urlopen.return_value = _make_response(expected)

        result = self.client.resolve(MINIMAL_CTX)

        self.assertEqual(result["expiresAt"], "2026-05-27T01:00:00+00:00")


class TestResolveMigration(unittest.TestCase):
    def setUp(self):
        self.client = AgentIdentityClient()

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_migration_success(self, mock_urlopen):
        expected = {
            "migrationId": "mig-001",
            "phase": "load",
            "sourceResolvedFor": "service",
            "targetResolvedFor": "service",
            "dryRun": False,
            "expiresAt": None,
        }
        mock_urlopen.return_value = _make_response(expected)

        result = self.client.resolve_migration(MINIMAL_MIGRATION)

        self.assertEqual(result["migrationId"], "mig-001")
        self.assertEqual(result["sourceResolvedFor"], "service")
        mock_urlopen.assert_called_once()

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_migration_injects_dry_run_false(self, mock_urlopen):
        req_without_dry_run = {k: v for k, v in MINIMAL_MIGRATION.items() if k != "dryRun"}
        expected = {
            "migrationId": "mig-001",
            "phase": "load",
            "sourceResolvedFor": "service",
            "targetResolvedFor": "service",
            "dryRun": False,
            "expiresAt": None,
        }
        mock_urlopen.return_value = _make_response(expected)

        self.client.resolve_migration(req_without_dry_run)  # type: ignore[arg-type]

        call_args = mock_urlopen.call_args
        request_obj = call_args[0][0]
        sent_body = json.loads(request_obj.data.decode())
        self.assertFalse(sent_body["dryRun"])

    @patch("agent_identity.urllib.request.urlopen")
    def test_resolve_migration_no_credential_raises(self, mock_urlopen):
        mock_urlopen.side_effect = _make_http_error({"error": "No credential resolved"}, 403)

        with self.assertRaises(NoCredentialError):
            self.client.resolve_migration(MINIMAL_MIGRATION)


class TestHealth(unittest.TestCase):
    def setUp(self):
        self.client = AgentIdentityClient()

    @patch("agent_identity.urllib.request.urlopen")
    def test_health_returns_true_on_200(self, mock_urlopen):
        mock_urlopen.return_value = _make_response({"ok": True})
        self.assertTrue(self.client.health())

    @patch("agent_identity.urllib.request.urlopen")
    def test_health_returns_false_on_connection_error(self, mock_urlopen):
        import urllib.error
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
        self.assertFalse(self.client.health())

    @patch("agent_identity.urllib.request.urlopen")
    def test_health_returns_false_on_500(self, mock_urlopen):
        mock_urlopen.side_effect = _make_http_error({"error": "Internal error"}, 500)
        self.assertFalse(self.client.health())


class TestExceptions(unittest.TestCase):
    def test_no_credential_error_is_agent_identity_error(self):
        err = NoCredentialError("No match", status_code=403)
        self.assertIsInstance(err, AgentIdentityError)
        self.assertEqual(err.status_code, 403)

    def test_validation_error_is_agent_identity_error(self):
        err = ValidationError("Bad input", status_code=400)
        self.assertIsInstance(err, AgentIdentityError)
        self.assertEqual(err.status_code, 400)

    def test_base_error_status_code_none(self):
        err = AgentIdentityError("Network failure")
        self.assertIsNone(err.status_code)


if __name__ == "__main__":
    unittest.main()
