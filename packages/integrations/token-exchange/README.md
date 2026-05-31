# @datacules/agent-identity-token-exchange

RFC 8693 OAuth 2.0 Token Exchange `CredentialStore` for [@datacules/agent-identity](https://github.com/hvrcharon1/agent-identity).

Exchanges a user's existing access or ID token for a narrowly-scoped downstream token at any compliant Authorization Server — without storing any long-lived credentials.

---

## The problem it solves

In many enterprise deployments an AI agent must call downstream services (CRM, ERP, data warehouse) on behalf of a specific user, but the user's primary OAuth token is either too broad (wrong audience, excessive scopes) or was issued by a different AS than the one the downstream service trusts. The agent cannot use the user's token directly and cannot store per-user long-lived secrets at scale.

**Token exchange** (RFC 8693) lets the agent present the user's existing token to a trusted AS and receive a new token scoped precisely to the downstream service — in one HTTP call, with no stored secrets.

---

## How it fits into agent-identity

`TokenExchangeStore` implements the standard `CredentialStore` interface, so it drops in anywhere a `MemoryCredentialStore`, `VaultCredentialStore`, or `AwsCredentialStore` would be used. The routing layer remains unchanged; only the store changes.

```typescript
import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
import { createRouterFromStore } from '@datacules/agent-identity';

// Closed over the current request's authenticated user token:
const subjectToken = req.headers.authorization?.replace('Bearer ', '');

const store = new TokenExchangeStore({
  configs: exchangeConfigs,
  subjectTokenProvider: async (_ref) => subjectToken ?? null,
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
// resolved.ref IS the exchanged access_token — injected server-side,
// never returned to the model or the client.
```

---

## Installation

```bash
npm install @datacules/agent-identity-token-exchange
# peer dependency:
npm install @datacules/agent-identity
```

---

## Quick start

### 1. Define exchange configurations

```typescript
import type { TokenExchangeConfig } from '@datacules/agent-identity-token-exchange';

export const exchangeConfigs: TokenExchangeConfig[] = [
  {
    // Matches the credentialRef in your RoutingRule
    ref:             'crm-service-token',
    name:            'CRM Service Token',
    kind:            'user-delegated',
    scope:           'crm:read crm:write',
    status:          'active',
    provider:        'openai',

    // Keycloak example
    tokenEndpoint:   'https://auth.acme.com/realms/prod/protocol/openid-connect/token',
    clientId:        'agent-identity',
    clientSecret:    process.env.AGENT_CLIENT_SECRET!,
    requestedScopes: ['crm:read', 'crm:write'],
    audience:        'https://crm.acme.com',
  },
];
```

### 2. Create routing rules

```typescript
import type { RoutingRule } from '@datacules/agent-identity';

export const rules: RoutingRule[] = [
  {
    id:            'rule-crm-user-delegated',
    description:   'Route CRM calls through token exchange',
    credentialRef: 'crm-service-token',   // matches TokenExchangeConfig.ref
    credentialKind:'user-delegated',
    priority:      80,
    matchProvider: 'openai',
    matchAction:   ['read', 'write'],
  },
];
```

### 3. Wire into your API route

```typescript
// src/app/api/resolve/route.ts (or Express / Fastify handler)
import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
import { createRouterFromStore } from '@datacules/agent-identity';
import { exchangeConfigs } from '@/lib/exchangeConfigs';
import { rules }           from '@/lib/rules';

export async function POST(req: Request) {
  const body         = await req.json();
  const subjectToken = req.headers.get('authorization')?.replace('Bearer ', '');

  const store = new TokenExchangeStore({
    configs:              exchangeConfigs,
    subjectTokenProvider: async (_ref) => subjectToken ?? null,
  });

  const router  = createRouterFromStore(store, rules);
  const resolved = await router.resolveAsync(body);

  if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 403 });
  return Response.json({ credentialId: resolved.credentialId, resolvedFor: resolved.resolvedFor });
}
```

---

## Authorization Server examples

### Keycloak

```typescript
{
  tokenEndpoint: `https://keycloak.acme.com/realms/${REALM}/protocol/openid-connect/token`,
  clientId:      'agent-identity',
  clientSecret:  process.env.KC_CLIENT_SECRET!,
  // Keycloak: enable token exchange in realm settings
  extraParams:   { requested_issuer: 'external-idp' }, // optional
}
```

### Auth0 (Enterprise)

```typescript
{
  tokenEndpoint: `https://${DOMAIN}/oauth/token`,
  clientId:      process.env.AUTH0_CLIENT_ID!,
  clientSecret:  process.env.AUTH0_CLIENT_SECRET!,
  audience:      'https://api.acme.com',
  requestedScopes: ['read:crm'],
}
```

### Azure AD / Entra ID (On-Behalf-Of)

```typescript
{
  tokenEndpoint:    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
  clientId:         process.env.AZURE_CLIENT_ID!,
  clientSecret:     process.env.AZURE_CLIENT_SECRET!,
  requestedScopes:  ['https://graph.microsoft.com/.default'],
  subjectTokenType: RFC_TOKEN_TYPES.ACCESS_TOKEN,
  // Azure OBO uses the same grant_type as RFC 8693
  extraParams:      { requested_token_use: 'on_behalf_of' },
}
```

### Okta (Token Exchange / act-as)

```typescript
{
  tokenEndpoint: `https://${OKTA_DOMAIN}/oauth2/${AUTH_SERVER_ID}/v1/token`,
  clientId:      process.env.OKTA_CLIENT_ID!,
  clientSecret:  process.env.OKTA_CLIENT_SECRET!,
  requestedScopes: ['crm:read'],
  audience:        'https://crm.acme.com',
}
```

---

## Cache management

Exchanged tokens are cached in-memory per store instance until 30 seconds before their `expires_in`-derived expiry.

```typescript
// Force re-exchange for a specific slot (e.g. after a 401 from downstream):
store.invalidateCache('crm-service-token');

// Flush all cached tokens:
store.flushCache();
```

For cross-request caching (e.g. in long-lived server processes), manage the store instance lifecycle in your DI container or request middleware and call `invalidateCache()` on downstream 401 responses.

---

## API reference

### `TokenExchangeStore`

| Method | Signature | Description |
|--------|-----------|-------------|
| `findByRef` | `(ref: string) => Promise<Credential \| null>` | Exchange subject token; returns credential with exchanged token as `ref` |
| `listActive` | `() => Promise<Credential[]>` | All configs with `status: 'active'` |
| `listByKind` | `(kind: CredentialKind) => Promise<Credential[]>` | Filter by `'fixed'` or `'user-delegated'` |
| `invalidateCache` | `(ref: string) => void` | Evict one cached token |
| `flushCache` | `() => void` | Evict all cached tokens |

### `TokenExchangeConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ref` | `string` | ✓ | Slot identifier — matches `credentialRef` in RoutingRule |
| `name` | `string` | ✓ | Human-readable label |
| `kind` | `CredentialKind` | ✓ | `'fixed'` or `'user-delegated'` |
| `scope` | `string` | ✓ | Scope description (used by `validateForMigration`) |
| `status` | `CredentialStatus` | ✓ | `'active'`, `'pending'`, or `'revoked'` |
| `tokenEndpoint` | `string` | ✓ | OAuth 2.0 token endpoint URL |
| `clientId` | `string` | ✓ | OAuth 2.0 `client_id` |
| `clientSecret` | `string` | — | OAuth 2.0 `client_secret` (omit for public clients) |
| `requestedScopes` | `string[]` | ✓ | Scopes to request for the exchanged token |
| `audience` | `string` | — | `audience` parameter (intended recipient service URL) |
| `subjectTokenType` | `RfcTokenType` | — | Default: `access_token` |
| `requestedTokenType` | `RfcTokenType` | — | Default: `access_token` |
| `extraParams` | `Record<string, string>` | — | AS-specific extension parameters |
| `provider` | `string` | — | Provider hint propagated to `Credential.provider` |
| `tags` | `string[]` | — | Compliance tags (`['pii', 'financial']`) |

### `RFC_TOKEN_TYPES`

Pre-defined URN constants for `subjectTokenType` and `requestedTokenType`:
`ACCESS_TOKEN`, `REFRESH_TOKEN`, `ID_TOKEN`, `SAML1`, `SAML2`, `JWT`.

---

## License

MIT — Datacules LLC
