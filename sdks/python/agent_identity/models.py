"""
Pydantic v2 models mirroring the TypeScript types in packages/core/src/types.ts.

These models are generated from the OpenAPI spec (docs/openapi.yaml) and kept
in sync manually. A future CI step will auto-generate them via openapi-generator.

All field names follow Python conventions (snake_case); the .model_dump(by_alias=True)
strategy or alias_generator handles camelCase serialisation to match the HTTP API.
"""
from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer
from pydantic.alias_generators import to_camel


# ─── Base config ─────────────────────────────────────────────────────────────

class _CamelModel(BaseModel):
    """Base class: snake_case in Python, camelCase over the wire."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,   # allow both userId and user_id on construction
        str_strip_whitespace=True,
    )


# ─── Enums (as Literal types for easy completion) ─────────────────────────────

SupportedProvider = Literal["openai", "anthropic", "gemini", "mistral", "local"]
ResourceKind = Literal["shared", "personal"]
MigrationPhase = Literal[
    "dry-run", "extract", "transform", "load", "verify", "rollback"
]


# ─── Request models ───────────────────────────────────────────────────────────

class AgentRequestContext(_CamelModel):
    """Mirrors AgentRequestContext in types.ts and AgentRequestContextSchema in schemas.ts."""

    user_id: str = Field(min_length=1)
    resource_id: str = Field(min_length=1)
    resource_kind: ResourceKind
    provider: SupportedProvider
    model: str = Field(min_length=1)
    action: str = Field(min_length=1)
    trace_id: str = Field(min_length=1)
    requested_at: datetime.datetime
    session_id: Optional[str] = None
    parent_trace_id: Optional[str] = None

    @field_serializer("requested_at")
    def _ser_dt(self, v: datetime.datetime) -> str:
        # Always UTC ISO 8601 with Z suffix — matches z.string().datetime() in Zod
        return v.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MigrateResolveRequest(_CamelModel):
    """Mirrors MigrateResolveRequestSchema in schemas.ts."""

    migration_id: str = Field(min_length=1)
    phase: MigrationPhase
    source_resource_id: str = Field(min_length=1)
    target_resource_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    provider: SupportedProvider
    model: str = Field(min_length=1)
    trace_id: str = Field(min_length=1)
    dry_run: bool = False
    batch_index: Optional[int] = Field(default=None, ge=0)
    total_batches: Optional[int] = Field(default=None, ge=1)


# ─── Response models ──────────────────────────────────────────────────────────

class ResolveResponse(_CamelModel):
    """Response from POST /api/resolve."""

    ok: bool
    resolved_for: str
    expires_at: Optional[datetime.datetime] = None


class MigrateResolveResponse(_CamelModel):
    """Response from POST /api/migrate/resolve."""

    migration_id: str
    phase: MigrationPhase
    source_resolved_for: str
    target_resolved_for: str
    dry_run: bool
    expires_at: Optional[datetime.datetime] = None


# ─── Error model ──────────────────────────────────────────────────────────────

class AgentIdentityError(Exception):
    """Raised when the server returns a non-2xx response."""

    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"agent-identity API error {status_code}: {body}")
