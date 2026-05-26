# agent-identity Python SDK

Pure-Python client for the `agent-identity` sidecar. No Node.js required.

## Install

```bash
pip install agent-identity
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
