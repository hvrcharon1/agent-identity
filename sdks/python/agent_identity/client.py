"""
Sync and async HTTP clients wrapping the agent-identity sidecar API.

Both clients use httpx under the hood:
  - AgentIdentityClient      — synchronous, suitable for scripts and frameworks
                               that don't use asyncio (Flask, Django, etc.)
  - AsyncAgentIdentityClient — async, suitable for FastAPI, LangChain async
                               chains, asyncio scripts, etc.

Neither client ever receives or stores raw credentials — only the resolved
identity string and an optional expiry time are returned from the server.
"""
from __future__ import annotations

from typing import Optional

import httpx

from .models import (
    AgentIdentityError,
    AgentRequestContext,
    MigrateResolveRequest,
    MigrateResolveResponse,
    ResolveResponse,
)

_DEFAULT_TIMEOUT = 10.0  # seconds


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_error:
        try:
            body = response.json()
        except Exception:
            body = response.text
        raise AgentIdentityError(response.status_code, body)


# ─── Synchronous client ───────────────────────────────────────────────────────

class AgentIdentityClient:
    """
    Synchronous HTTP client for the agent-identity sidecar.

    Usage::

        client = AgentIdentityClient(base_url="http://localhost:3001")
        result = client.resolve(ctx)
        pair   = client.resolve_migration(req)
        client.close()   # or use as context manager

    Context manager usage::

        with AgentIdentityClient(base_url="http://localhost:3001") as client:
            result = client.resolve(ctx)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        timeout: float = _DEFAULT_TIMEOUT,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Content-Type": "application/json", **(headers or {})},
        )

    # ── resolve ───────────────────────────────────────────────────────────────

    def resolve(self, ctx: AgentRequestContext) -> ResolveResponse:
        """
        POST /api/resolve — resolve a single credential for an agent request.

        Returns a ResolveResponse containing the resolved identity and an
        optional expiry time. Raises AgentIdentityError on non-2xx responses.
        """
        response = self._client.post(
            "/api/resolve",
            content=ctx.model_dump_json(by_alias=True),
        )
        _raise_for_status(response)
        return ResolveResponse.model_validate(response.json())

    # ── resolve_migration ─────────────────────────────────────────────────────

    def resolve_migration(self, req: MigrateResolveRequest) -> MigrateResolveResponse:
        """
        POST /api/migrate/resolve — resolve source + target credentials for a
        migration phase in a single round-trip.

        Returns a MigrateResolveResponse with both resolved identities and the
        earliest expiry of the pair. Raises AgentIdentityError on non-2xx.
        """
        response = self._client.post(
            "/api/migrate/resolve",
            content=req.model_dump_json(by_alias=True),
        )
        _raise_for_status(response)
        return MigrateResolveResponse.model_validate(response.json())

    # ── health ────────────────────────────────────────────────────────────────

    def health(self) -> dict:  # type: ignore[type-arg]
        """GET /health — returns the sidecar health payload."""
        response = self._client.get("/health")
        _raise_for_status(response)
        return response.json()  # type: ignore[no-any-return]

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying httpx.Client and release connections."""
        self._client.close()

    def __enter__(self) -> "AgentIdentityClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


# ─── Async client ─────────────────────────────────────────────────────────────

class AsyncAgentIdentityClient:
    """
    Async HTTP client for the agent-identity sidecar.

    Usage::

        async with AsyncAgentIdentityClient(base_url="http://localhost:3001") as client:
            result = await client.resolve(ctx)
            pair   = await client.resolve_migration(req)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        timeout: float = _DEFAULT_TIMEOUT,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            headers={"Content-Type": "application/json", **(headers or {})},
        )

    async def resolve(self, ctx: AgentRequestContext) -> ResolveResponse:
        """POST /api/resolve (async)."""
        response = await self._client.post(
            "/api/resolve",
            content=ctx.model_dump_json(by_alias=True),
        )
        _raise_for_status(response)
        return ResolveResponse.model_validate(response.json())

    async def resolve_migration(self, req: MigrateResolveRequest) -> MigrateResolveResponse:
        """POST /api/migrate/resolve (async)."""
        response = await self._client.post(
            "/api/migrate/resolve",
            content=req.model_dump_json(by_alias=True),
        )
        _raise_for_status(response)
        return MigrateResolveResponse.model_validate(response.json())

    async def health(self) -> dict:  # type: ignore[type-arg]
        """GET /health (async)."""
        response = await self._client.get("/health")
        _raise_for_status(response)
        return response.json()  # type: ignore[no-any-return]

    async def aclose(self) -> None:
        """Close the underlying httpx.AsyncClient."""
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncAgentIdentityClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()
