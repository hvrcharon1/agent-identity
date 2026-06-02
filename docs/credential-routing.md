<p align="center">
  <img src="../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# Credential Routing

The credential router lives at `packages/core/src/router.ts` and is the core of the agent identity system. It is published as part of `@datacules/agent-identity`.

## How it works

1. Each agent request carries an `AgentRequestContext` — the calling user, target resource, resource kind (`shared` / `personal`), provider, model, and action.
2. The router scans the configured `RoutingRule[]` in descending priority order.
3. The first matching rule points to a `credentialRef` — a slot identifier, not a raw secret.
4. The router looks up the active credential with that ref from the configured `CredentialStore`.
5. Expiry, budget, approval gate, and SPIFFE/scope checks are enforced.
6. The credential is injected into the outbound request via the provider adapter.
7. An audit log entry is written with the resolved identity.

## Security invariants

- The model layer **never** receives raw credentials — only opaque refs resolved server-side.
- Every routed request produces an audit entry: `userId`, `action`, `resource`, `credentialId`, `resolvedFor`, `traceId`.
- User-delegated credentials are scoped to what that user already has — the agent cannot escalate.
- `readOnly: true` on a rule rejects credentials without read scope before any call is made.
- `reserve()` / `release()` on the store prevent concurrent migration corruption.

## Rule matching dimensions

| Field | Type | Description |
|---|---|---|
| `resourceKind` | `'shared' \| 'personal'` | Match by resource kind |
| `matchProvider` | `SupportedProvider` | Match by AI provider |
| `matchAction` | `string \| string[]` | Match by action(s) |
| `matchUserId` | `string` | Match a specific user |
| `matchSpiffeId` | `string` | Match a SPIFFE workload ID (glob-friendly) |
| `matchPhase` | `string \| string[]` | Match migration phase(s) |
| `canaryRef` | `string` | Secondary credential ref for canary traffic |
| `canaryWeight` | `number` | Percentage of traffic routed to `canaryRef` (0–100) |
| `readOnly` | `boolean` | Enforce read-only scope validation |
| `priority` | `number` | Higher value wins (evaluated descending) |

Omit any `match*` field to match any value for that dimension.

## Standard rule

```typescript
import type { RoutingRule } from '@datacules/agent-identity';

const rule: RoutingRule = {
  id: 'rule-personal-docs',
  resourceKind: 'personal',
  credentialKind: 'user-delegated',
  credentialRef: 'user-oauth-ref',
  description: "Use the calling user's own token for personal document access.",
  priority: 10,
};
```

## Canary rule

Slowly shift traffic to a new credential without a deployment:

```typescript
const canaryRule: RoutingRule = {
  id: 'rule-shared-crm-canary',
  credentialRef: 'openai-prod-v1',   // 95% of traffic
  canaryRef:     'openai-prod-v2',   // 5% of traffic
  canaryWeight:  5,
  credentialKind: 'fixed',
  priority: 50,
};
```

## Migration rule (phase-aware)

```typescript
const extractRule: RoutingRule = {
  id: 'migration-extract',
  matchPhase: 'extract',
  readOnly: true,
  credentialRef: 'source-readonly-slot',
  credentialKind: 'fixed',
  priority: 60,
};
```

## SPIFFE rule

```typescript
const spiffeRule: RoutingRule = {
  id: 'rule-orders-agent',
  matchSpiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent',
  credentialRef: 'orders-db-slot',
  credentialKind: 'fixed',
  priority: 90,
};
```

## Dual-credential resolution (`resolvePair`)

For migration workflows that need both a source and a target credential in one call:

```typescript
const pair = router.resolvePair(migrationCtx);
// pair.source — read credential for sourceResourceId
// pair.target — write credential for targetResourceId
// pair.expiresAt — earliest expiry of both
```

## Router factory

```typescript
import { createRouter, MemoryCredentialStore } from '@datacules/agent-identity';

const router = createRouter(credentials, rules, auditLogger);
// or, for a custom store:
const router = createRouterFromStore(new VaultCredentialStore(), rules, auditLogger);
```
