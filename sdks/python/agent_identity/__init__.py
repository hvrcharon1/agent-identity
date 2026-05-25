"""
agent-identity Python SDK
~~~~~~~~~~~~~~~~~~~~~~~~~

Sync and async HTTP clients for the agent-identity credential router.
Drop-in with any Python AI framework: LangChain, LlamaIndex, raw httpx, etc.

Typical usage::

    from agent_identity import AgentIdentityClient, AgentRequestContext
    client = AgentIdentityClient(base_url="http://localhost:3001")
    result = client.resolve(ctx)
"""

from .models import (
    AgentRequestContext,
    MigrateResolveRequest,
    ResolveResponse,
    MigrateResolveResponse,
    SupportedProvider,
    ResourceKind,
    MigrationPhase,
)
from .client import AgentIdentityClient, AsyncAgentIdentityClient

__all__ = [
    # Models
    "AgentRequestContext",
    "MigrateResolveRequest",
    "ResolveResponse",
    "MigrateResolveResponse",
    "SupportedProvider",
    "ResourceKind",
    "MigrationPhase",
    # Clients
    "AgentIdentityClient",
    "AsyncAgentIdentityClient",
]

__version__ = "0.1.0"
