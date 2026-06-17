# Example: RFC 8693 OAuth 2.0 Token Exchange (Keycloak)

Exchange a user's access token for a scoped downstream token at request time via any OAuth 2.0 Authorization Server. No long-term user token storage required.

**Use when:** agents act on behalf of individual users but you don't want to store per-user tokens long-term. The subject token is exchanged at call time and cached briefly.
**Avoid when:** all users share the same service credential (use the [fixed credential example](../anthropic-fixed-cred/) instead).

## Flow

```
User request (with access token)
  └── router.resolveAsync({ provider: 'openai', ... })
        └── TokenExchangeStore.findByRef('crm-service-token')
              └── POST to Keycloak token endpoint (RFC 8693)
                    ├── grant_type=urn:ietf:params:oauth:grant-type:token-exchange
                    ├── subject_token=<user access token>
                    └── audience=https://crm.example.com
              └── Cached response (with 30s expiry buffer)
        └── ResolvedCredential { ref: <exchanged downstream token> }
```

## Prerequisites

1. A Keycloak realm (or Auth0 / Azure AD / Okta) with token exchange enabled
2. Environment variables:
   - `KEYCLOAK_TOKEN_ENDPOINT` — e.g. `https://auth.example.com/realms/prod/protocol/openid-connect/token`
   - `AGENT_CLIENT_ID` — OAuth client ID for the agent
   - `AGENT_CLIENT_SECRET` — OAuth client secret
   - `USER_ACCESS_TOKEN` — a valid user access/ID token to exchange

## Run

```bash
cd examples/token-exchange
npm install

# With real credentials:
USER_ACCESS_TOKEN=eyJ... node index.js

# Demo mode (uses placeholder values):
node index.js
```

Expected output:
```
[1] First resolve (cache miss) — exchanging subject token...
    Resolved in 42 ms
    credentialId: crm-service-token
    resolvedFor:  user-alice
    kind:         user-delegated
    scope:        crm:read crm:write

[2] Second resolve (cache hit) — should be near-instant...
    Resolved in 0 ms
    Same ref? yes (cache hit)

[3] Invalidating cache and re-exchanging...
    Resolved in 38 ms
    New token? yes (fresh exchange)
```

## Key concepts

- **`TokenExchangeStore`** implements `CredentialStore` — plug it into `createRouterFromStore()` with no other changes
- **`subjectTokenProvider`** is a closure over the current request's user token — called on every cache miss
- **`invalidateCache(ref)`** forces a fresh exchange on the next resolve
- **`flushCache()`** clears all cached tokens (useful for logout flows)
- The exchanged token is injected server-side as an `Authorization: Bearer` header — it never reaches the model or client layer

## Supported Authorization Servers

`TokenExchangeStore` works with any RFC 8693-compliant AS:

| Provider | Token endpoint pattern |
|----------|----------------------|
| Keycloak | `https://<host>/realms/<realm>/protocol/openid-connect/token` |
| Auth0 | `https://<tenant>.auth0.com/oauth/token` |
| Azure AD | `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` |
| Okta | `https://<domain>/oauth2/default/v1/token` |

See [`@datacules/agent-identity-token-exchange`](../../packages/integrations/token-exchange/) for full API documentation.
