<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# @datacules/agent-identity-mcp

MCP server adapter for [`@datacules/agent-identity`](../../core). Exposes credential resolution as MCP tools so any MCP-capable client — **Claude Desktop, Claude Code, Cursor, Windsurf**, or a custom agent — can resolve credentials without touching the HTTP REST API.

## Install

```bash
npm install @datacules/agent-identity-mcp
```

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
// GET  http://127.0.0.1:3002/sse          → SSE stream
// POST http://127.0.0.1:3002/messages     → tool calls
```

### With a custom CredentialStore

```typescript
import { VaultCredentialStore } from '@datacules/agent-identity-store-vault';

const store = new VaultCredentialStore({
  address: process.env.VAULT_ADDR!,
  token:   process.env.VAULT_TOKEN!,
});
const { start } = createAgentIdentityMcpServer({ store, rules });
await start();
```

## App Connector Configs

agent-identity works as an MCP server in **Claude Desktop, Claude Code, Cursor, Codex**, and any other MCP-capable client. All use the same stdio transport — only the config file format differs.

### Encoding credentials and rules

All configs require base64-encoded JSON arrays:

```bash
# Encode your credentials
echo '[{"id":"cred-1","kind":"fixed","name":"OpenAI Prod","scope":"All projects","status":"active","ref":"vault:openai-prod"}]' | base64

# Encode your rules
echo '[{"id":"rule-1","credentialRef":"vault:openai-prod","priority":100,"matchProvider":"openai"}]' | base64
```

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "npx",
      "args": ["-y", "@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded credentials>",
        "AGENT_IDENTITY_RULES": "<base64-encoded rules>"
      }
    }
  }
}
```

### Claude Code

**Option A — CLI command (user-scoped):**

```bash
claude mcp add agent-identity \
  -e AGENT_IDENTITY_CREDENTIALS="<base64>" \
  -e AGENT_IDENTITY_RULES="<base64>" \
  -- npx @datacules/agent-identity-mcp
```

**Option B — Project-scoped (committed to repo):**

Create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "npx",
      "args": ["-y", "@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "${AGENT_IDENTITY_CREDENTIALS}",
        "AGENT_IDENTITY_RULES": "${AGENT_IDENTITY_RULES}"
      }
    }
  }
}
```

Set the env vars in your shell or `.env` — Claude Code expands `${VAR}` references at runtime.

### Cursor

Add to `.cursor/mcp.json` (project-scoped) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "agent-identity": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded credentials>",
        "AGENT_IDENTITY_RULES": "<base64-encoded rules>"
      }
    }
  }
}
```

### Codex (OpenAI)

Add to `.codex/config.toml` (project-scoped) or `~/.codex/config.toml` (global):

```toml
[mcp_servers.agent-identity]
command = "npx"
args = ["-y", "@datacules/agent-identity-mcp"]
startup_timeout_sec = 30

[mcp_servers.agent-identity.env]
AGENT_IDENTITY_CREDENTIALS = "<base64-encoded credentials>"
AGENT_IDENTITY_RULES = "<base64-encoded rules>"
```

### Windsurf

Windsurf uses the same JSON format as Cursor. Add to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "agent-identity": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded credentials>",
        "AGENT_IDENTITY_RULES": "<base64-encoded rules>"
      }
    }
  }
}
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

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
