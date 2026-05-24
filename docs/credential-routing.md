# Credential Routing

The credential router (`src/lib/router.ts`) is the core of the agent identity system.

## How it works

1. Each agent request carries an `AgentRequestContext` — the calling user, target resource, resource kind (shared/personal), provider, and action.
2. The router scans the configured `RoutingRule[]` for a match on `resourceKind`.
3. The matching rule points to a `credentialRef` — a slot identifier, not a raw secret.
4. The router looks up the active credential with that ref.
5. The credential is injected into the outbound request via the provider adapter.
6. An audit log entry is written with the resolved identity.

## Security invariants

- The model layer **never** receives raw credentials.
- Credential refs are opaque identifiers resolved server-side.
- Every routed request produces an audit entry tagging: userId, action, resource, credentialId, resolvedFor.
- User-delegated credentials are scoped to what that user already has — the agent cannot escalate.

## Adding a new routing rule

```typescript
const rule: RoutingRule = {
  id: 'rule-new',
  resourceKind: 'shared',       // or 'personal'
  credentialKind: 'fixed',      // or 'user-delegated'
  credentialRef: 'my-cred-ref',
  description: 'Describe when this rule applies.',
};
```
