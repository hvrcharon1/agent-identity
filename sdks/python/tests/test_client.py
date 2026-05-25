"""
Unit tests for AgentIdentityClient and AsyncAgentIdentityClient.
Uses respx to mock httpx transport — no real network calls.
"""
from __future__ import annotations

import datetime
import json

import httpx
import pytest
import respx

from agent_identity import (
    AgentIdentityClient,
    AgentRequestContext,
    AsyncAgentIdentityClient,
    MigrateResolveRequest,
)
from agent_identity.models import AgentIdentityError

# ─── Fixtures ─────────────────────────────────────────────────────────────────

BASE_URL = "http://localhost:3001"

_CTX = AgentRequestContext(
    user_id="user-abc",
    resource_id="kb",
    resource_kind="shared",
    provider="anthropic",
    model="claude-sonnet-4-20250514",
    action="read",
    trace_id="t-001",
    requested_at=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
)

_MIG_REQ = MigrateResolveRequest(
    migration_id="mig-001",
    phase="load",
    source_resource_id="db-prod",
    target_resource_id="db-v2",
    user_id="svc-bot",
    provider="anthropic",
    model="claude-sonnet-4-20250514",
    trace_id="t-002",
    dry_run=False,
)

_RESOLVE_RESP = {"ok": True, "resolvedFor": "service", "expiresAt": "2026-01-01T02:00:00Z"}
_MIGRATE_RESP = {
    "migrationId": "mig-001",
    "phase": "load",
    "sourceResolvedFor": "service",
    "targetResolvedFor": "service",
    "dryRun": False,
    "expiresAt": "2026-01-01T02:00:00Z",
}


# ─── Sync client tests ────────────────────────────────────────────────────────

class TestAgentIdentityClient:
    @respx.mock(base_url=BASE_URL)
    def test_resolve_success(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("/api/resolve").mock(
            return_value=httpx.Response(200, json=_RESOLVE_RESP)
        )
        with AgentIdentityClient(base_url=BASE_URL) as client:
            result = client.resolve(_CTX)
        assert result.resolved_for == "service"
        assert result.expires_at is not None

    @respx.mock(base_url=BASE_URL)
    def test_resolve_403_raises(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("/api/resolve").mock(
            return_value=httpx.Response(403, json={"error": "No credential resolved"})
        )
        with pytest.raises(AgentIdentityError) as exc_info:
            with AgentIdentityClient(base_url=BASE_URL) as client:
                client.resolve(_CTX)
        assert exc_info.value.status_code == 403

    @respx.mock(base_url=BASE_URL)
    def test_resolve_migration_success(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("/api/migrate/resolve").mock(
            return_value=httpx.Response(200, json=_MIGRATE_RESP)
        )
        with AgentIdentityClient(base_url=BASE_URL) as client:
            pair = client.resolve_migration(_MIG_REQ)
        assert pair.source_resolved_for == "service"
        assert pair.target_resolved_for == "service"
        assert pair.dry_run is False

    @respx.mock(base_url=BASE_URL)
    def test_health(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.get("/health").mock(
            return_value=httpx.Response(200, json={"ok": True, "credentialCount": 3})
        )
        with AgentIdentityClient(base_url=BASE_URL) as client:
            h = client.health()
        assert h["ok"] is True

    def test_serialisation_camel_case(self) -> None:
        """Ensure snake_case Python fields serialise to camelCase over the wire."""
        payload = json.loads(_CTX.model_dump_json(by_alias=True))
        assert "userId" in payload
        assert "resourceId" in payload
        assert "resourceKind" in payload
        assert "traceId" in payload
        assert "requestedAt" in payload
        assert "user_id" not in payload


# ─── Async client tests ───────────────────────────────────────────────────────

class TestAsyncAgentIdentityClient:
    @respx.mock(base_url=BASE_URL)
    async def test_resolve_success(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("/api/resolve").mock(
            return_value=httpx.Response(200, json=_RESOLVE_RESP)
        )
        async with AsyncAgentIdentityClient(base_url=BASE_URL) as client:
            result = await client.resolve(_CTX)
        assert result.resolved_for == "service"

    @respx.mock(base_url=BASE_URL)
    async def test_resolve_migration_success(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("/api/migrate/resolve").mock(
            return_value=httpx.Response(200, json=_MIGRATE_RESP)
        )
        async with AsyncAgentIdentityClient(base_url=BASE_URL) as client:
            pair = await client.resolve_migration(_MIG_REQ)
        assert pair.migration_id == "mig-001"
