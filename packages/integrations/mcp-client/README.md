# @datacules/agent-identity-mcp-client

Outbound MCP integration for [`@datacules/agent-identity`](../../core). Consumes external MCP servers as `CredentialStore` implementations, allowing the credential router to pull credentials **from** any MCP-speaking secrets server — such as another `@datacules/agent-identity-mcp` instance, a Vault MCP server, a 1Password MCP server, or a custom server.

## Exports

| Export | Description |
|--------|-------------|
| `McpCredentialStore` | `CredentialStore` impl — fetches via MCP `list_credentials` tool |
| `McpToolCaller` | Direct tool caller — `resolveCredential`, `health`, arbitrary tools |

Both classes support `http` (SSE to a running server) and `stdio` (spawns a process) transports.

## Usage — McpCredentialStore

Drop it into any `CredentialRouter` with no other changes:

```typescript
import { McpCredentialStore } from '@datacules/agent-identity-mcp-client';
import { createRouterFromStore } from '@datacules/agent-identity';

// HTTP transport (connect to a running agent-identity-mcp server)
const store = new McpCredentialStore({
  transport: 'http',
  serverUrl: 'http://vault-mcp.internal:3002',
  authToken: process.env.MCP_AUTH_TOKEN,   // optional
  cacheTtlMs: 30_000,                       // optional, default 60s
});

const router = createRouterFromStore(store, rules, logger);

// Credential resolution is now backed by the remote MCP server
const resolved = router.resolve(ctx);

// Disconnect on shutdown
process.on('SIGTERM', () => store.disconnect());
```

```typescript
// stdio transport (spawn a local server process)
const store = new McpCredentialStore({
  transport: 'stdio',
  command: 'npx',
  args: ['@datacules/agent-identity-mcp'],
  env: {
    AGENT_IDENTITY_CREDENTIALS: process.env.AGENT_IDENTITY_CREDENTIALS!,
    AGENT_IDENTITY_RULES: process.env.AGENT_IDENTITY_RULES!,
  },
});
```

## Usage — McpToolCaller

For when you want to call the MCP server directly, without a local router:

```typescript
import { McpToolCaller } from '@datacules/agent-identity-mcp-client';

const caller = new McpToolCaller({
  transport: 'http',
  serverUrl: 'http://localhost:3002',
});

// Typed helpers
const result = await caller.resolveCredential({
  userId: 'user-1', resourceId: 'kb-1', resourceKind: 'personal',
  provider: 'anthropic', model: 'claude-sonnet-4-20250514',
  action: 'read', traceId: 'trace-001',
});
console.log(result.credentialId, result.resolvedFor);

const health = await caller.health();
console.log(health.credentialsLoaded, health.rulesLoaded);

// Arbitrary tool call
const rules = await caller.callTool('list_rules', {});

await caller.disconnect();
```

## Full MCP integration picture

```
┌──────────────────────────────────────────┐
│        MCP Client                       │
│  (Claude Desktop / Claude Code /       │
│   Cursor / custom agent)               │
└──────────────────────────────────────────┘
         │ MCP tools (resolve_credential etc.)
         ▼  INBOUND
┌──────────────────────────────────────────┐
│  @datacules/agent-identity-mcp         │
│  (MCP Server — stdio or HTTP+SSE)      │
└──────────────────────────────────────────┘
         │ CredentialStore interface
         ▼
┌──────────────────────────────────────────┐
│  @datacules/agent-identity-mcp-client  │
│  McpCredentialStore                    │  OUTBOUND
│  (fetches from external MCP servers)   │
└──────────────────────────────────────────┘
         │ MCP tools (list_credentials)
         ▼
┌──────────────────────────────────────────┐
│  External MCP Credential Server        │
│  (Vault MCP / 1Password MCP /          │
│   custom secrets server)               │
└──────────────────────────────────────────┘
```
