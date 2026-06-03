<p align="center">
  <img src="../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# agent-identity Python SDK

`pip install datacules-agent-identity`

Pure-Python client for the `agent-identity` sidecar. No Node.js required in your Python environment — the sidecar runs separately (Docker or `npm run dev`).

## Install

```bash
pip install datacules-agent-identity
```

## Usage

```python
from agent_identity import AgentIdentityClient
from datetime import datetime, timezone

client = AgentIdentityClient(base_url="http://localhost:3001")

# Resolve a credential for a single agent request
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
print(resolved["resolvedFor"])  # 'service' or userId

# Resolve source + target credentials for a migration phase
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
print(pair["expiresAt"])  # ISO 8601 or None
```

## Async client

```python
import asyncio
from agent_identity import AsyncAgentIdentityClient

async def main():
    async with AsyncAgentIdentityClient(base_url="http://localhost:3001") as client:
        resolved = await client.resolve({...})
        print(resolved["resolvedFor"])

asyncio.run(main())
```

## LangChain integration

```python
from langchain_anthropic import ChatAnthropic
from agent_identity import AgentIdentityClient

client = AgentIdentityClient()
resolved = client.resolve({...})

# resolved["resolvedFor"] is safe to log; the raw API key stays on the server
llm = ChatAnthropic(model="claude-sonnet-4-20250514")
# The sidecar injects the API key server-side when you call /api/resolve
```

## Error handling

```python
from agent_identity import AgentIdentityClient, NoCredentialError, ValidationError

try:
    result = client.resolve(ctx)
except NoCredentialError:
    # 403 — no routing rule matched this context
    ...
except ValidationError as e:
    # 400 — bad request body
    print(e)
```

## Starting the sidecar

```bash
# Docker
docker pull datacules/agent-identity
docker run -p 3001:3001 datacules/agent-identity

# Or from source
git clone https://github.com/hvrcharon1/agent-identity.git
cd agent-identity && npm install --legacy-peer-deps && npm run dev
# Then point your Python client at http://localhost:3000 (dev) or :3001 (Docker)
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
