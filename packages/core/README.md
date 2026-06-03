<p align="center">
  <img src="../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity`

Core credential routing engine for the agent-identity framework. Provider-agnostic; works with OpenAI, Anthropic, Gemini, Mistral, and local models.

Published as the `@datacules/agent-identity` npm package from `packages/core/`.

## Install

```bash
npm install @datacules/agent-identity
```

## What's in this package

| Export | Description |
|--------|-------------|
| `createRouter` | Build a `CredentialRouter` from an array of credentials + rules |
| `createRouterFromStore` | Build a router backed by any `CredentialStore` |
| `createRouterWithConfig` | Full-featured factory — accepts attestation signer, budget enforcer, approval gate |
| `MemoryCredentialStore` | In-memory store for dev + tests |
| `CredentialRouter` | Class with `resolve()`, `resolveAsync()`, `resolvePair()`, `resolvePairAsync()` |
| `@datacules/agent-identity/schemas` | Zod schemas for `AgentRequestContext`, `MigrationContext`, `Credential` |
| `@datacules/agent-identity/react` | `useAgentIdentity` React hook (server-side credential resolution) |

## Quick start

```typescript
import { createRouter } from '@datacules/agent-identity';
import type { AgentRequestContext, Credential, RoutingRule } from '@datacules/agent-identity';

const credentials: Credential[] = [
  {
    id: 'cred-openai-prod',
    ref: 'vault:openai-prod-key',
    kind: 'fixed',
    provider: 'openai',
    status: 'active',
  },
];

const rules: RoutingRule[] = [
  {
    id: 'rule-default',
    credentialRef: 'vault:openai-prod-key',
    credentialKind: 'fixed',
    priority: 10,
  },
];

const router = createRouter(credentials, rules);

const ctx: AgentRequestContext = {
  userId:      'user-abc',
  resourceId:  'knowledge-base',
  resourceKind:'personal',
  provider:    'openai',
  model:       'gpt-4o',
  action:      'read',
  traceId:     crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
};

const resolved = router.resolve(ctx);
// resolved.ref        → 'vault:openai-prod-key' — look this up in your vault, server-side
// resolved.resolvedFor → 'service' (or the userId for user-delegated)
```

## Routing rule fields

```typescript
const rule: RoutingRule = {
  id:             'rule-personal-docs',
  credentialRef:  'user-oauth-slot',     // ref to a Credential
  credentialKind: 'user-delegated',      // 'fixed' | 'user-delegated'
  priority:       10,                    // higher = evaluated first
  resourceKind:   'personal',            // optional match
  matchProvider:  'anthropic',           // optional match
  matchAction:    ['read', 'write'],     // optional match
  matchUserId:    'user-abc',            // optional match
  matchSpiffeId:  'spiffe://acme.com/ns/prod/sa/agent', // optional
  matchPhase:     'extract',             // migration phase match
  canaryRef:      'user-oauth-slot-v2', // optional canary credential
  canaryWeight:   5,                    // 0–100% traffic to canary
  readOnly:       true,                 // enforce read scope
};
```

## Migration: `resolvePair`

```typescript
import type { MigrationContext } from '@datacules/agent-identity';

const pair = router.resolvePair(ctx as MigrationContext);
// pair.source  — read credential for sourceResourceId
// pair.target  — write credential for targetResourceId
// pair.expiresAt — earliest expiry of both
```

## Zod schemas

```typescript
import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';

const parsed = AgentRequestContextSchema.safeParse(body);
if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
```

## React hook

```typescript
import { useAgentIdentity } from '@datacules/agent-identity/react';

function Component({ userId }: { userId: string }) {
  const { resolvedFor, loading, error, expiresAt } = useAgentIdentity({
    userId, resourceId: 'kb', resourceKind: 'personal',
    provider: 'anthropic', model: 'claude-sonnet-4-20250514',
    action: 'read', traceId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  });
  // ...
}
```

See the [root README](../../README.md) for the full API reference and all integration options.
