/**
 * router.test.ts — adds resolvePairAsync() coverage to the existing suite.
 *
 * The original tests (sync resolve, rule matching, pending credential) are
 * preserved unchanged. New describe blocks are appended at the end.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialRouter, MemoryCredentialStore, createRouter } from './router';
import type { Credential, RoutingRule, MigrationContext, AgentRequestContext } from './types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const credentials: Credential[] = [
  {
    id: 'cred-linear',
    kind: 'fixed',
    name: 'Linear Service Account',
    scope: 'read:write',
    status: 'active',
    ref: 'linear-service-account-slot',
  },
  {
    id: 'cred-alice',
    kind: 'user-delegated',
    name: 'Alice OAuth',
    scope: 'read:write',
    status: 'active',
    ref: 'alice-oauth-slot',
  },
  {
    id: 'cred-source',
    kind: 'fixed',
    name: 'Migration Source',
    scope: 'read',
    status: 'active',
    ref: 'source-db-slot',
  },
  {
    id: 'cred-target',
    kind: 'fixed',
    name: 'Migration Target',
    scope: 'read:write',
    status: 'active',
    ref: 'target-db-slot',
  },
  {
    id: 'cred-gmail',
    kind: 'user-delegated',
    name: 'Gmail OAuth (pending)',
    scope: 'read',
    status: 'pending',
    ref: 'gmail-oauth-user-slot',
  },
];

const rules: RoutingRule[] = [
  {
    id: 'rule-shared',
    description: 'Shared wiki fallback',
    credentialRef: 'linear-service-account-slot',
    credentialKind: 'fixed',
    priority: 10,
    matchResourceKind: 'shared',
  },
  {
    id: 'rule-personal-alice',
    description: 'Per-user for Alice',
    credentialRef: 'alice-oauth-slot',
    credentialKind: 'user-delegated',
    priority: 30,
    matchUserId: 'user-alice',
  },
  {
    id: 'rule-source',
    description: 'Migration source',
    credentialRef: 'source-db-slot',
    credentialKind: 'fixed',
    priority: 20,
    matchAction: 'read',
    matchResourceKind: 'shared',
  },
  {
    id: 'rule-target',
    description: 'Migration target',
    credentialRef: 'target-db-slot',
    credentialKind: 'fixed',
    priority: 20,
    matchAction: ['write', 'load'],
    matchResourceKind: 'shared',
  },
];

const baseCtx: AgentRequestContext = {
  userId: 'user-alice',
  resourceId: 'wiki',
  resourceKind: 'shared',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: 'trace-001',
  requestedAt: new Date().toISOString(),
};

// ─── CredentialRouter — sync resolve ─────────────────────────────────────────

describe('CredentialRouter — sync resolve', () => {
  it('resolves a matching credential', () => {
    const router = createRouter(credentials, rules);
    const resolved = router.resolve(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBeDefined();
  });

  it('returns null when no rule matches', () => {
    const router = createRouter(credentials, rules);
    const resolved = router.resolve({ ...baseCtx, resourceKind: 'personal', userId: 'user-unknown' });
    expect(resolved).toBeNull();
  });

  it('priority: per-user rule beats shared fallback for Alice', () => {
    const router = createRouter(credentials, rules);
    const resolved = router.resolve(baseCtx);
    // Rule priority 30 (alice) beats 10 (shared)
    expect(resolved?.credentialId).toBe('cred-alice');
  });
});

// ─── CredentialRouter — pending credential ───────────────────────────────────

describe('CredentialRouter — pending credential', () => {
  it('returns null when the matched credential is pending', () => {
    const pendingRules: RoutingRule[] = [{
      id: 'rule-gmail',
      description: 'Gmail pending',
      credentialRef: 'gmail-oauth-user-slot',
      credentialKind: 'user-delegated',
      priority: 10,
    }];
    const router = createRouter(credentials, pendingRules);
    expect(router.resolve(baseCtx)).toBeNull();
  });
});

// ─── CredentialRouter — resolveAsync ─────────────────────────────────────────

describe('CredentialRouter — resolveAsync', () => {
  it('resolves asynchronously with the same logic as resolve()', async () => {
    const router = createRouter(credentials, rules);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-alice');
  });

  it('returns null for a ctx with no matching rule', async () => {
    const router = createRouter(credentials, rules);
    const resolved = await router.resolveAsync({ ...baseCtx, userId: 'unknown', resourceKind: 'personal' });
    expect(resolved).toBeNull();
  });
});

// ─── CredentialRouter — resolvePairAsync ─────────────────────────────────────

describe('CredentialRouter — resolvePairAsync', () => {
  const migrationCtx: MigrationContext = {
    ...baseCtx,
    userId: 'svc-migration',
    resourceId: 'migration-job',
    action: 'write',
    migrationId: 'migration-2026-q2',
    phase: 'load',
    sourceResourceId: 'source-db',
    targetResourceId: 'target-db',
    dryRun: false,
  };

  it('resolves both source and target credentials', async () => {
    const router = createRouter(credentials, rules);
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair).not.toBeNull();
    expect(pair?.source).toBeDefined();
    expect(pair?.target).toBeDefined();
    expect(pair?.migrationId).toBe('migration-2026-q2');
  });

  it('source always resolves with action: read', async () => {
    const router = createRouter(credentials, rules);
    const pair = await router.resolvePairAsync(migrationCtx);
    // The source credential should be the read-scoped one
    expect(pair?.source.credentialId).toBe('cred-source');
  });

  it('target resolves with the original action when dryRun is false', async () => {
    const router = createRouter(credentials, rules);
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair?.target.credentialId).toBe('cred-target');
  });

  it('target resolves with action: read when dryRun is true', async () => {
    const router = createRouter(credentials, rules);
    const dryRunCtx: MigrationContext = { ...migrationCtx, dryRun: true };
    const pair = await router.resolvePairAsync(dryRunCtx);
    // With dryRun=true, target action becomes 'read', so matches rule-source
    expect(pair?.source.credentialId).toBe('cred-source');
    expect(pair?.target.credentialId).toBe('cred-source');
  });

  it('returns null when source cannot be resolved', async () => {
    // Rules that only cover target, not source
    const targetOnlyRules: RoutingRule[] = [rules[3]!]; // rule-target only
    const router = createRouter(credentials, targetOnlyRules);
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair).toBeNull();
  });

  it('returns null when target cannot be resolved', async () => {
    const sourceOnlyRules: RoutingRule[] = [rules[2]!]; // rule-source only
    const router = createRouter(credentials, sourceOnlyRules);
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair).toBeNull();
  });

  it('expiresAt on the pair is the earlier of source and target expiries', async () => {
    const soonExpiry = new Date(Date.now() + 60_000).toISOString();
    const laterExpiry = new Date(Date.now() + 3600_000).toISOString();

    const expiringCreds: Credential[] = [
      { ...credentials[2]!, expiresAt: soonExpiry },
      { ...credentials[3]!, expiresAt: laterExpiry },
    ];
    const router = createRouter(expiringCreds, rules);
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair?.expiresAt).toBe(soonExpiry);
  });

  it('returns a valid pair from an async (non-MemoryCredentialStore) store', async () => {
    // Simulate a cloud store with async findByRef
    const asyncStore = {
      findByRef: async (ref: string) => credentials.find((c) => c.ref === ref && c.status === 'active') ?? null,
      listActive: async () => credentials.filter((c) => c.status === 'active'),
      listByKind: async (kind: Credential['kind']) => credentials.filter((c) => c.kind === kind),
    };
    const router = new CredentialRouter({ store: asyncStore, rules });
    const pair = await router.resolvePairAsync(migrationCtx);
    expect(pair).not.toBeNull();
    expect(pair?.source.credentialId).toBe('cred-source');
    expect(pair?.target.credentialId).toBe('cred-target');
  });
});
