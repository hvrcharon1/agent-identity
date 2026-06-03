<p align="center">
  <img src="../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# agent-identity Examples

Runnable examples for every major integration pattern. Each example is self-contained — run `npm install && node index.js` (or `node server.js`).

## Examples

| Example | Pattern | Packages used |
|---------|---------|---------------|
| [`openai-user-delegated/`](./openai-user-delegated/) | Per-user credential — each user resolves their own OpenAI key | `@datacules/agent-identity`, `@datacules/agent-identity-audit` |
| [`anthropic-fixed-cred/`](./anthropic-fixed-cred/) | Fixed service account — single key for all users | `@datacules/agent-identity`, `@datacules/agent-identity-audit` |
| [`hybrid-routing/`](./hybrid-routing/) | Context-switched — shared vs personal resource routing | `@datacules/agent-identity`, `@datacules/agent-identity-audit` |
| [`langchain-agent/`](./langchain-agent/) | LangChain integration — Tool, Model, LangGraph node | `@datacules/agent-identity-langchain` |
| [`mcp-server/`](./mcp-server/) | MCP server — expose credential resolution as MCP tools | `@datacules/agent-identity-mcp` |
| [`token-exchange/`](./token-exchange/) | RFC 8693 token exchange — cache miss, cache hit, invalidate | `@datacules/agent-identity-token-exchange` |

## Which pattern should I use?

| Situation | Recommended example |
|-----------|---------------------|
| All users have the same access to the same resource | [`anthropic-fixed-cred`](./anthropic-fixed-cred/) |
| Users have different access levels (per-user quotas, billing) | [`openai-user-delegated`](./openai-user-delegated/) |
| One agent touches both shared tools and personal resources | [`hybrid-routing`](./hybrid-routing/) |
| You use LangChain agents or LangGraph | [`langchain-agent`](./langchain-agent/) |
| You want Claude Desktop or Cursor to resolve credentials | [`mcp-server`](./mcp-server/) |
| Agent must act as a user without storing per-user tokens | [`token-exchange`](./token-exchange/) |

## Running an example

```bash
cd examples/<example-name>
npm install
node index.js   # or node server.js for mcp-server
```

All examples use in-memory credential stores with placeholder `vault:...` refs.
To connect to a real vault, swap `createRouter` for `createRouterFromStore` with a cloud store:

```typescript
import { AwsCredentialStore }          from '@datacules/agent-identity-store-aws';
import { VaultCredentialStore }        from '@datacules/agent-identity-store-vault';
import { AzureKeyVaultCredentialStore } from '@datacules/agent-identity-store-azure';
import { createRouterFromStore }       from '@datacules/agent-identity';

const store  = new AwsCredentialStore({ region: 'us-east-1' });
const router = createRouterFromStore(store, rules, logger);
```
