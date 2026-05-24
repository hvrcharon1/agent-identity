# Provider Integration

The `ProviderAdapter` interface in `src/lib/providers.ts` normalizes credential injection across AI providers.

## Adding a new provider

```typescript
import type { ProviderAdapter } from '@/lib/types';

const myProvider: ProviderAdapter = {
  id: 'my-provider' as SupportedProvider,
  label: 'My Provider',
  injectCredential(request, credential) {
    return {
      ...request,
      // inject credential reference here
      // raw secret is resolved server-side from credential.ref
      _credentialRef: credential.ref,
      _resolvedFor: credential.resolvedFor,
    };
  },
};
```

Then add it to `PROVIDER_ADAPTERS` in `providers.ts` and extend `SupportedProvider` in `types.ts`.

## Supported providers

| Provider | Adapter | Credential injection method |
|---|---|---|
| OpenAI | `openaiAdapter` | `Authorization` header + `user` field |
| Anthropic | `anthropicAdapter` | `x-api-key` header + `metadata.user_id` |
| Gemini | `geminiAdapter` | Bearer token header |
| Mistral | `mistralAdapter` | Bearer token header |
| Local | `localAdapter` | Custom header or body field |
