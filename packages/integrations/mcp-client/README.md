<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-mcp-client`

MCP client adapter for the agent-identity framework. Implements `CredentialStore` against any external MCP server, so the router can pull credentials from a Vault MCP server, 1Password MCP, or any custom credential MCP server as a drop-in backend.

## Install

```bash
npm install @datacules/agent-identity-mcp-client @datacules/agent-identity
```

## Usage

```typescript
import { McpCredentialStore }  from '@datacules/agent-identity-mcp-client';
import { createRouterFromStore } from '@datacules/agent-identity';

// HTTP + SSE — connect to a running MCP server
const store = new McpCredentialStore({
  transport: 'http',
  serverUrl: 'http://localhost:3002',
});

// stdio — spawn a local MCP server process
const store = new McpCredentialStore({
  transport: 'stdio',
  command:   'npx',
  args:      ['@datacules/agent-identity-mcp'],
  env: {
    AGENT_IDENTITY_CREDENTIALS: process.env.AGENT_IDENTITY_CREDENTIALS!,
    AGENT_IDENTITY_RULES:       process.env.AGENT_IDENTITY_RULES!,
  },
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```

## Direct tool calls: `McpToolCaller`

For typed access to MCP tools without a local router:

```typescript
import { McpToolCaller } from '@datacules/agent-identity-mcp-client';

const caller = new McpToolCaller({
  transport: 'http',
  serverUrl: 'http://localhost:3002',
});

const resolved = await caller.resolveCredential(ctx);
const pair     = await caller.resolveMigrationCredential(migCtx);
const alive    = await caller.health();
const rules    = await caller.callTool('list_rules', {}); // generic escape hatch
```

## Lazy connect + caching

Both `McpCredentialStore` and `McpToolCaller` connect lazily on the first call and maintain an in-memory cache with the same TTL semantics as the local `MemoryCredentialStore`. The connection is shared across requests for the lifetime of the store instance.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
