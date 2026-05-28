# Example: agent-identity MCP Server

Exposes credential resolution as [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools. Any MCP-capable client — Claude Desktop, Claude Code, Cursor, Windsurf, or a custom agent — can call these tools directly over stdio or HTTP+SSE.

## Tools exposed

| Tool | Description |
|------|-------------|
| `resolve_credential` | Resolve a credential for an `AgentRequestContext` |
| `resolve_migration_credential` | Resolve source + target pair for a migration |
| `list_credentials` | List active credentials (safe metadata — no raw refs) |
| `list_rules` | List routing rules by priority |
| `health` | Liveness check |

## Run

### stdio transport (Claude Desktop / Claude Code / Cursor)

```bash
cd examples/mcp-server
npm install
node server.js
```

### HTTP+SSE transport (networked deployments)

```bash
node server.js --transport http
# Server listening on http://localhost:3002
# SSE endpoint: http://localhost:3002/sse
```

## Claude Desktop setup

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "node",
      "args": ["/absolute/path/to/examples/mcp-server/server.js"]
    }
  }
}
```

Or use `npx` to run the published package:

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "npx",
      "args": ["@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded-credentials-json>",
        "AGENT_IDENTITY_RULES": "<base64-encoded-rules-json>"
      }
    }
  }
}
```

## Claude Code setup

```bash
claude mcp add agent-identity \
  -e AGENT_IDENTITY_CREDENTIALS=$(echo '[{...}]' | base64) \
  -e AGENT_IDENTITY_RULES=$(echo '[{...}]' | base64) \
  -- npx @datacules/agent-identity-mcp
```

## Connecting with McpCredentialStore (outbound)

Pull credentials from this server into another agent-identity deployment:

```typescript
import { McpCredentialStore } from '@datacules/agent-identity-mcp-client';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new McpCredentialStore({
  transport: 'http',
  serverUrl: 'http://localhost:3002',
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```
