# `@datacules/agent-identity-store-authmd`

auth.md-compatible [`CredentialStore`](../../core) for [`@datacules/agent-identity`](../../core).
Registers your agent with downstream services using the auth.md protocol, supporting three
registration flows: **ID-JAG** assertion, **verified-email** + OTP claim ceremony, and **anonymous** + optional upgrade ceremony.

## Install

```bash
npm install @datacules/agent-identity-store-authmd @datacules/agent-identity
```

## Quick start

```typescript
import { createRouterWithConfig } from '@datacules/agent-identity';
import { AgentAuthMdStore } from '@datacules/agent-identity-store-authmd';

const store = new AgentAuthMdStore({
  configs: [
    {
      ref:               'example-api',
      kind:              'fixed',
      name:              'Example Service',
      scope:             'read write',
      status:            'active',
      resourceServerUrl: 'https://api.example.com',
      methodPreference:  ['id-jag', 'anonymous'],
      idJagProvider: {
        async mintForAudience(audience) {
          // Return a signed ID-JAG JWT for the given audience URL
          return myIdJagSigner.sign({ aud: audience });
        },
      },
    },
  ],
});

const router = createRouterWithConfig({ store, rules: myRules });
const resolved = await router.resolveAsync(ctx);
// resolved.ref is the access_token obtained from the service
```

## Registration flows

| Flow | When used | Result |
|---|---|---|  
| `id-jag` | Service supports ID-JAG assertions | `status: 'active'` credential with `access_token` |
| `verified-email` | Service requires verified email + OTP | Returns `null` until `completeClaimCeremony()` |
| `anonymous` | No identity required | `status: 'unclaimed'` credential; upgrade with claim ceremony |

## OTP claim ceremony

```typescript
// After findByRef() with verified-email or anonymous:
await store.startClaimCeremony('example-api');     // triggers OTP email/SMS
const cred = await store.completeClaimCeremony('example-api', '123456');
// cred.status === 'active', cred.claimedAt is set
```

## Caching

Tokens are cached until `expiryBufferMs` before expiry (default 30 s). Invalidate manually:

```typescript
store.invalidateCache('example-api'); // single ref
store.flushCache();                   // all refs
```

## Revocation

`revokeByIdentity()` clears the full cache when a `logout+jwt` is received at
your `revocation_uri`. Wire it up via the core `RevocationHandler`:

```typescript
import { RevocationHandler, RevocationListener } from '@datacules/agent-identity';

const listener = new RevocationListener({
  handler: new RevocationHandler(store),
  verifier: myJwtVerifier,
});

// In your Express route:
app.post('/agent/auth/revoke', async (req, res) => {
  const result = await listener.handleRequest(req.body, req.headers);
  res.status(result.httpStatus).json(result.body);
});
```

## Error handling

`findByRef()` never throws. It returns `null` on any:
- Non-2xx HTTP response from discovery or registration endpoints
- Network error / DNS failure
- Missing `idJagProvider` when `id-jag` method is selected
