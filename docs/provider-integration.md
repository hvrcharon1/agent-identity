<p align="center">
  <img src="../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# Provider Integration

The `ProviderAdapter` interface lives in `packages/core/src/providers.ts` and normalises credential injection across AI providers. It is exported from `@datacules/agent-identity`.

## Supported providers

| Provider | Adapter | Credential injection method | `validateForMigration` |
|---|---|---|---|
| OpenAI | `openaiAdapter` | `Authorization: Bearer` header + `user` field | ✓ |
| Anthropic | `anthropicAdapter` | `x-api-key` header + `metadata.user_id` | ✓ |
| Gemini | `geminiAdapter` | Bearer token header | ✓ |
| Mistral | `mistralAdapter` | Bearer token header | ✓ |
| Local | `localAdapter` | Custom header or body field | ✓ |

## Adding a new provider

```typescript
import type { ProviderAdapter } from '@datacules/agent-identity';

const myProvider: ProviderAdapter = {
  id: 'my-provider' as SupportedProvider,
  label: 'My Provider',
  injectCredential(request, credential) {
    return {
      ...request,
      // inject credential reference here
      // raw secret is resolved server-side from credential.ref — never passed to the model
      _credentialRef: credential.ref,
      _resolvedFor:   credential.resolvedFor,
    };
  },
  validateForMigration(credential, phase) {
    // Optional but strongly recommended.
    // Throw here to prevent a credential being used in the wrong migration phase.
    if ((phase === 'load' || phase === 'rollback') && !credential.scope?.includes('write')) {
      throw new Error(`[my-provider] write scope required for migration phase '${phase}'`);
    }
  },
};
```

Then:
1. Add `'my-provider'` to `SupportedProvider` in `packages/core/src/types.ts`.
2. Register `myProvider` in `PROVIDER_ADAPTERS` in `packages/core/src/providers.ts`.
3. Write tests in `packages/core/src/providers.test.ts`.

## OTEL span attributes

Every `resolve()` / `resolveAsync()` call emits a span when the router is wrapped with `withOtel()`. The span carries:

| Attribute | Example value |
|---|---|
| `agent_identity.provider` | `anthropic` |
| `agent_identity.user_id` | `user-abc` |
| `agent_identity.resource_id` | `knowledge-base` |
| `agent_identity.resource_kind` | `personal` |
| `agent_identity.action` | `read` |
| `agent_identity.credential_id` | `cred-anthropic-prod` |
| `agent_identity.resolved_for` | `user-abc` |
| `agent_identity.trace_id` | `<uuid>` |

## Migration scope validation

All five built-in adapters implement `validateForMigration(credential, phase)`. This is called by the router during `resolvePair()` and throws immediately if a read-only credential is used in a `load` or `rollback` phase — the error surfaces at the routing layer before any writes are attempted.
