"""
agent_identity — Python SDK for the agent-identity credential routing sidecar

Installation:
    pip install datacules-agent-identity
    # or directly:
    pip install git+https://github.com/hvrcharon1/agent-identity.git#subdirectory=packages/python-sdk

Usage:
    from agent_identity import AgentIdentityClient
    from datetime import datetime, timezone

    client = AgentIdentityClient(base_url="http://localhost:3001")

    resolved = client.resolve({
        "userId": "user-abc",
        "resourceId": "crm-db",
        "resourceKind": "shared",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "action": "read",
        "traceId": "trace-xyz",
        "requestedAt": datetime.now(timezone.utc).isoformat(),
    })

    pair = client.resolve_migration({
        "migrationId": "migration-2026-q2",
        "phase": "load",
        "sourceResourceId": "crm-postgres-prod",
        "targetResourceId": "crm-postgres-v2",
        "userId": "svc-migration-bot",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "traceId": "trace-abc123",
        "dryRun": False,
    })
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional, TypedDict

try:
    import urllib.request as _urllib
except ImportError:  # pragma: no cover
    raise RuntimeError("agent-identity requires Python 3.8+")


# ─── Type aliases ────────────────────────────────────────────────────────────────────

ResourceKind  = Literal["shared", "personal"]
SupportedProvider = Literal["openai", "anthropic", "gemini", "mistral", "local"]
MigrationPhase = Literal["dry-run", "extract", "transform", "load", "verify", "rollback"]


class AgentRequestContext(TypedDict, total=False):
    userId: str           # required
    resourceId: str       # required
    resourceKind: ResourceKind  # required
    provider: SupportedProvider  # required
    model: str            # required
    action: str           # required
    traceId: str          # required
    requestedAt: str      # required (ISO 8601)
    sessionId: str        # optional
    parentTraceId: str    # optional


class MigrateResolveRequest(TypedDict, total=False):
    migrationId: str      # required
    phase: MigrationPhase  # required
    sourceResourceId: str  # required
    targetResourceId: str  # required
    userId: str           # required
    provider: SupportedProvider  # required
    model: str            # required
    traceId: str          # required
    dryRun: bool          # optional, default False
    batchIndex: int       # optional
    totalBatches: int     # optional


class ResolveResponse(TypedDict):
    ok: bool
    resolvedFor: str
    expiresAt: Optional[str]


class MigrateResolveResponse(TypedDict):
    migrationId: str
    phase: MigrationPhase
    sourceResolvedFor: str
    targetResolvedFor: str
    dryRun: bool
    expiresAt: Optional[str]


# ─── Exceptions ───────────────────────────────────────────────────────────────────

class AgentIdentityError(Exception):
    """Base exception for all agent-identity SDK errors."""
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class NoCredentialError(AgentIdentityError):
    """Raised when the server returns 403 — no routing rule matched."""


class ValidationError(AgentIdentityError):
    """Raised when the server returns 400 — invalid request body."""


# ─── Client ────────────────────────────────────────────────────────────────────────

class AgentIdentityClient:
    """
    Thin HTTP client for the agent-identity sidecar.
    No Node.js required — pure Python 3.8+ stdlib.

    Args:
        base_url: URL of the running sidecar, e.g. 'http://localhost:3001'
        timeout:  Request timeout in seconds (default 10)
    """

    def __init__(self, base_url: str = "http://localhost:3001", timeout: int = 10) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ─── Public API ────────────────────────────────────────────────────────────────────

    def resolve(self, ctx: AgentRequestContext) -> ResolveResponse:
        """
        Resolve the best credential for a single agent request.

        Args:
            ctx: AgentRequestContext dict — all required fields must be present.
                 If 'requestedAt' is omitted, the current UTC time is used.

        Returns:
            ResolveResponse with resolvedFor and optional expiresAt.

        Raises:
            ValidationError:    Server returned 400 (missing/invalid field).
            NoCredentialError:  Server returned 403 (no rule matched).
            AgentIdentityError: Any other HTTP error.
        """
        if "requestedAt" not in ctx:
            ctx = {**ctx, "requestedAt": datetime.now(timezone.utc).isoformat()}  # type: ignore[assignment]
        return self._post("/api/resolve", ctx)  # type: ignore[return-value]

    def resolve_migration(
        self, request: MigrateResolveRequest
    ) -> MigrateResolveResponse:
        """
        Resolve source + target credentials for a migration phase.

        Call once at the start of each phase. The returned expiresAt lets
        the agent decide when to re-call before the batch loop ends.

        Args:
            request: MigrateResolveRequest dict.

        Returns:
            MigrateResolveResponse with sourceResolvedFor, targetResolvedFor,
            and optional expiresAt (earliest of the two credentials).
        """
        if "dryRun" not in request:
            request = {**request, "dryRun": False}  # type: ignore[assignment]
        return self._post("/api/migrate/resolve", request)  # type: ignore[return-value]

    def health(self) -> bool:
        """Returns True if the sidecar is reachable and healthy."""
        try:
            self._post("/api/health", {}, method="GET")
            return True
        except AgentIdentityError:
            return False
        except Exception:  # noqa: BLE001
            return False

    # ─── Internal ──────────────────────────────────────────────────────────────────────

    def _post(self, path: str, body: Dict[str, Any], method: str = "POST") -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8")
        req = _urllib.Request(
            url,
            data=data if method == "POST" else None,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method=method,
        )
        try:
            with _urllib.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except _urllib.HTTPError as e:
            status = e.code
            try:
                error_body = json.loads(e.read().decode("utf-8"))
                message = error_body.get("error", str(e))
            except Exception:  # noqa: BLE001
                message = str(e)

            if status == 400:
                raise ValidationError(message, status_code=status) from e
            if status == 403:
                raise NoCredentialError(message, status_code=status) from e
            raise AgentIdentityError(message, status_code=status) from e
        except Exception as e:
            raise AgentIdentityError(f"Request failed: {e}") from e
