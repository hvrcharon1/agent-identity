# Example: OpenAI + User-Delegated Auth

Demonstrates per-user credential routing. Each user resolves their own OpenAI API key — the model layer never receives any raw secret.

## Flow

```
User N request
  └── router.resolve({ userId: 'user-N', resourceKind: 'personal', provider: 'openai' })
        └── matches rule-N  →  ResolvedCredential { ref: 'vault:openai/user-N-slot' }
              └── openaiAdapter.injectCredential(resolved, requestConfig)
                    └── OpenAI API call (Authorization header set server-side)
```

The model never sees the credential — only the resolved `ref` travels through application code. The raw API key is fetched from your vault at the moment of injection.

## Run

```bash
cd examples/openai-user-delegated
npm install
node index.js
```

Expected output:
```
[user-alice] Resolved credential:
  id   : cred-user-alice
  kind : user-delegated
  ref  : vault:openai/user-alice-slot
  Authorization header set: true

[user-bob] Resolved credential:
  id   : cred-user-bob
  kind : user-delegated
  ref  : vault:openai/user-bob-slot
  Authorization header set: true

Audit log shows every resolution with full traceability.
The raw API keys never appear in this output — only the credential refs.
```

## Production swap-in

Replace `MemoryCredentialStore` (default for `createRouter`) with a cloud store:

```typescript
import { AwsCredentialStore } from '@datacules/agent-identity-store-aws';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new AwsCredentialStore({
  region: 'us-east-1',
  secretsManagerPrefix: 'agent-identity/',
  dynamoTableName: 'agent-identity-locks',
});
const router = createRouterFromStore(store, rules, logger);
```

## Key principles

- The model layer **never receives raw credentials** — only resolved refs
- Every resolution is **audited** with userId, resourceId, action, traceId
- Rules are **explicit** — no magic fallback, no silent credential sharing
- Per-user credentials give you **full traceability** for every AI action
