# agent-identity Python SDK

Python client for the [agent-identity](https://github.com/hvrcharon1/agent-identity) credential router.
Call the sidecar HTTP API from any Python application — LangChain agents, raw scripts, FastAPI services, etc.

## Installation

```bash
pip install agent-identity
```

## Quick start

```python
from agent_identity import AgentIdentityClient, AgentRequestContext
import datetime

client = AgentIdentityClient(base_url="http://localhost:3001")

ctx = AgentRequestContext(
    user_id="user-abc",
    resource_id="knowledge-base",
    resource_kind="shared",
    provider="anthropic",
    model="claude-sonnet-4-20250514",
    action="read",
    trace_id="trace-xyz-001",
    requested_at=datetime.datetime.now(datetime.timezone.utc),
)

result = client.resolve(ctx)
print(result.resolved_for)   # "service" or user id
print(result.expires_at)     # datetime | None
```

## Async usage

```python
import asyncio
from agent_identity import AsyncAgentIdentityClient, AgentRequestContext

async def main():
    async with AsyncAgentIdentityClient(base_url="http://localhost:3001") as client:
        result = await client.resolve(ctx)
        print(result.resolved_for)

asyncio.run(main())
```

## Migration resolve

```python
from agent_identity import MigrateResolveRequest

req = MigrateResolveRequest(
    migration_id="migration-2026-q2",
    phase="load",
    source_resource_id="crm-postgres-prod",
    target_resource_id="crm-postgres-v2",
    user_id="svc-migration-bot",
    provider="anthropic",
    model="claude-sonnet-4-20250514",
    trace_id="trace-abc123",
    dry_run=False,
)

pair = client.resolve_migration(req)
print(pair.source_resolved_for)
print(pair.target_resolved_for)
print(pair.expires_at)
```

## CLI

```bash
# Resolve a credential (JSON output)
agent-identity resolve --base-url http://localhost:3001 \
  --user-id user-abc --resource-id kb --resource-kind shared \
  --provider anthropic --model claude-sonnet-4-20250514 \
  --action read --trace-id t-001
```
