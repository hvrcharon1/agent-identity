/**
 * agent-identity example: RFC 8693 OAuth 2.0 Token Exchange (Keycloak)
 *
 * Demonstrates:
 *   - Constructing a TokenExchangeStore with a Keycloak token endpoint
 *   - Wiring it into createRouterFromStore
 *   - Resolving a user-delegated CRM token via resolveAsync()
 *   - Cache hit on the second resolve call
 *   - invalidateCache() to force re-exchange on the next call
 *
 * Prerequisites:
 *   1. A Keycloak realm with token exchange enabled
 *   2. KEYCLOAK_TOKEN_ENDPOINT, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET env vars set
 *   3. A valid user access token in USER_ACCESS_TOKEN env var
 *
 * Run:
 *   USER_ACCESS_TOKEN=eyJ... node index.js
 */

import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
import { createRouterFromStore } from '@datacules/agent-identity';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// ─── Exchange configuration ───────────────────────────────────────────────────

const exchangeConfigs = [
  {
    ref:             'crm-service-token',
    name:            'CRM Service Token',
    kind:            'user-delegated',
    scope:           'crm:read crm:write',
    status:          'active',
    provider:        'openai',
    tokenEndpoint:   process.env.KEYCLOAK_TOKEN_ENDPOINT ??
                     'https://auth.example.com/realms/prod/protocol/openid-connect/token',
    clientId:        process.env.AGENT_CLIENT_ID        ?? 'agent-identity-client',
    clientSecret:    process.env.AGENT_CLIENT_SECRET    ?? 'demo-secret',
    requestedScopes: ['crm:read', 'crm:write'],
    audience:        'https://crm.example.com',
  },
];

// ─── Routing rules ────────────────────────────────────────────────────────────

const rules = [
  {
    id:             'rule-crm-user-delegated',
    description:    'Route all CRM calls through token exchange',
    credentialRef:  'crm-service-token',
    credentialKind: 'user-delegated',
    priority:       80,
    matchProvider:  'openai',
  },
];

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const userAccessToken = process.env.USER_ACCESS_TOKEN ?? 'demo-subject-token';

  // Create the store — subjectTokenProvider is a closure over the current
  // request's authenticated user token.
  const store = new TokenExchangeStore({
    configs:              exchangeConfigs,
    subjectTokenProvider: async (_ref) => userAccessToken,
  });

  const router = createRouterFromStore(store, rules, new ConsoleAuditLogger());

  const ctx = {
    userId:      'user-alice',
    resourceId:  'crm-contacts',
    resourceKind:'shared',
    provider:    'openai',
    model:       'gpt-4o',
    action:      'read',
    traceId:     `trace-${Date.now()}`,
    requestedAt: new Date().toISOString(),
  };

  // ── First resolve: cache miss — HTTP request to Keycloak ─────────────────
  console.log('\n[1] First resolve (cache miss) — exchanging subject token...');
  const t0 = Date.now();
  const first = await router.resolveAsync(ctx);
  console.log(`    Resolved in ${Date.now() - t0} ms`);

  if (first) {
    console.log('    credentialId:', first.credentialId);
    console.log('    resolvedFor: ', first.resolvedFor);
    console.log('    kind:        ', first.kind);
    console.log('    scope:       ', first.scope);
    console.log('    expiresAt:   ', first.expiresAt);
    console.log('    ref (token): ', first.ref.slice(0, 20) + '...');
  } else {
    console.log('    ⚠️  No credential resolved. Check env vars and Keycloak config.');
  }

  // ── Second resolve: cache hit — no HTTP request ───────────────────────────
  console.log('\n[2] Second resolve (cache hit) — should be near-instant...');
  const t1 = Date.now();
  const second = await router.resolveAsync(ctx);
  console.log(`    Resolved in ${Date.now() - t1} ms`);
  if (first && second) {
    console.log('    Same ref?', first.ref === second.ref ? '✔ yes (cache hit)' : '✖ no');
  }

  // ── Invalidate cache and re-exchange ─────────────────────────────────────
  console.log('\n[3] Invalidating cache and re-exchanging...');
  store.invalidateCache('crm-service-token');
  const t2 = Date.now();
  const third = await router.resolveAsync(ctx);
  console.log(`    Resolved in ${Date.now() - t2} ms`);
  if (first && third) {
    console.log('    New token?', first.ref !== third?.ref ? '✔ yes (fresh exchange)' : '✖ same');
  }

  console.log('\nDone. In production the exchanged ref is injected server-side as an');
  console.log('Authorization: Bearer header — it never reaches the model or client layer.');
}

main().catch(console.error);
