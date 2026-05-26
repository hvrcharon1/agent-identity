# @datacules/agent-identity-mcp

MCP server adapter for [`@datacules/agent-identity`](../../core). Exposes credential resolution as MCP tools so any MCP-capable client — **Claude Desktop, Claude Code, Cursor, Windsurf**, or a custom agent — can resolve credentials without touching the HTTP REST API.

## Tools exposed

| Tool | Description |
|------|-------------|
| `resolve_credential` | Resolve the correct credential for an `AgentRequestContext` |
| `resolve_migration_credential` | Resolve source + target credential pair for a migration workflow |
| `list_credentials` | List active credentials (safe metadata — no raw refs or secrets) |
| `list_rules` | List routing rules ordered by priority |
| `health` | Liveness check + loaded credential/rule counts |

## Transports

| Mode | Use case |
|------|----------|
| `stdio` (default) | Claude Desktop, Claude Code, Cursor, Windsurf config blocks |
| `http+sse` | Hosted / networked deployments reachable over HTTP |

## Quick start

### As a library (stdio)

```typescript
import { createAgentIdentityMcpServer } from '@datacules/agent-identity-mcp';
import type { Credential, RoutingRule } from '@datacules/agent-identity';

const credentials: Credential[] = [ /* ... */ ];
const rules: RoutingRule[] = [ /* ... */ ];

const { start } = createAgentIdentityMcpServer({ credentials, rules });
await start(); // reads from stdin, writes to stdout
```

### As a library (HTTP + SSE)

```typescript
const { start, stop } = createAgentIdentityMcpServer({
  credentials,
  rules,
  transport: 'http',
  httpPort: 3002,
  httpAuthToken: process.env.MCP_AUTH_TOKEN, // optional
});
await start();
// Server now accepts SSE at GET http://127.0.0.1:3002/sse
// and tool calls at POST http://127.0.0.1:3002/messages?sessionId=<id>
```

### With a custom CredentialStore

```typescript
import { VaultCredentialStore } from '@datacules/agent-identity-store-vault';

const store = new VaultCredentialStore({ address: process.env.VAULT_ADDR!, token: process.env.VAULT_TOKEN! });
const { start } = createAgentIdentityMcpServer({ store, rules });
await start();
```

## Claude Desktop config

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "npx",
      "args": ["@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded JSON array of Credential objects>",
        "AGENT_IDENTITY_RULES": "<base64-encoded JSON array of RoutingRule objects>"
      }
    }
  }
}
```

To encode your data:
```bash
echo '[{"id":"cred-1", ...}]' | base64
```

## Claude Code config

```bash
claude mcp add agent-identity -e AGENT_IDENTITY_CREDENTIALS=<base64> -e AGENT_IDENTITY_RULES=<base64> -- npx @datacules/agent-identity-mcp
```

## Environment variables (standalone CLI)

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_IDENTITY_CREDENTIALS` | required | Base64-encoded JSON array of `Credential` objects |
| `AGENT_IDENTITY_RULES` | required | Base64-encoded JSON array of `RoutingRule` objects |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `3002` | HTTP port (only when `MCP_TRANSPORT=http`) |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address |
| `MCP_HTTP_AUTH_TOKEN` | — | Optional bearer token for HTTP auth |
