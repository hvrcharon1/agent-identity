/**
 * router.test.ts — comprehensive coverage for CredentialRouter.
 *
 * Groups:
 *  1. Sync resolve                            (3 cases — original)
 *  2. Pending credential                      (1 case  — original)
 *  3. resolveAsync — basic                    (2 cases — original)
 *  4. resolvePairAsync — migration pair       (8 cases — original)
 *  5. Canary routing                          (4 cases — new)
 *  6. Expiry enforcement                      (3 cases — new)
 *  7. readOnly scope enforcement              (2 cases — new)
 *  8. Audit logger                            (1 case  — new)
 *  9. Budget enforcer                         (2 cases — new)
 * 10. Approval gate                           (3 cases — new)
 * 11. Attestation signer                      (2 cases — new)
 * 12. matchSpiffeId rule matching             (2 cases — new)
 * 13. isSyncCapable guard                     (1 case  — new)
 * 14. createRouterWithConfig factory          (1 case  — new)
 *
 * Total: 35 test cases (14 original + 21 new)
 */
import { describe, it, expect, vi } from 'vitest';
import { CredentialRouter, MemoryCredentialStore, createRouter, createRouterWithConfig } from './router';
import type { Credential, RoutingRule, MigrationContext, AgentRequestContext, AttestationSigner, ApprovalPolicy } from './types';
import type { ApprovalManager } from './approval';
import type { BudgetEnforcer } from './budget';

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

// ─── CredentialRouter — canary routing ───────────────────────────────────────

describe('CredentialRouter — canary routing', () => {
  const canaryCredentials: Credential[] = [
    {
      id: 'cred-primary',
      kind: 'fixed',
      name: 'Primary API',
      scope: 'read:write',
      status: 'active',
      ref: 'primary-api-slot',
    },
    {
      id: 'cred-canary',
      kind: 'fixed',
      name: 'Canary API',
      scope: 'read:write',
      status: 'active',
      ref: 'canary-api-slot',
    },
  ];

  const canaryCtx: AgentRequestContext = {
    userId: 'svc-canary-test',
    resourceId: 'api-gateway',
    resourceKind: 'shared',
    provider: 'openai',
    model: 'gpt-4o',
    action: 'call',
    traceId: 'trace-canary-001',
    requestedAt: new Date().toISOString(),
  };

  it('routes to canary credential when Math.random falls below canaryWeight', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.3); // 30 < 50 → canary
    const rule: RoutingRule = {
      id: 'rule-canary-50',
      description: 'Canary split at 50%',
      credentialRef: 'primary-api-slot',
      credentialKind: 'fixed',
      priority: 10,
      canaryRef: 'canary-api-slot',
      canaryWeight: 50,
    };
    const router = createRouter(canaryCredentials, [rule]);
    const resolved = await router.resolveAsync(canaryCtx);
    expect(resolved?.credentialId).toBe('cred-canary');
    expect(resolved?.isCanary).toBe(true);
    vi.restoreAllMocks();
  });

  it('routes to primary credential when Math.random is at or above canaryWeight', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.7); // 70 >= 50 → primary
    const rule: RoutingRule = {
      id: 'rule-canary-50',
      description: 'Canary split at 50%',
      credentialRef: 'primary-api-slot',
      credentialKind: 'fixed',
      priority: 10,
      canaryRef: 'canary-api-slot',
      canaryWeight: 50,
    };
    const router = createRouter(canaryCredentials, [rule]);
    const resolved = await router.resolveAsync(canaryCtx);
    expect(resolved?.credentialId).toBe('cred-primary');
    expect(resolved?.isCanary).toBe(false);
    vi.restoreAllMocks();
  });

  it('always routes to primary when canaryWeight is 0', async () => {
    const rule: RoutingRule = {
      id: 'rule-no-canary',
      description: 'Canary disabled (weight 0)',
      credentialRef: 'primary-api-slot',
      credentialKind: 'fixed',
      priority: 10,
      canaryRef: 'canary-api-slot',
      canaryWeight: 0,
    };
    const router = createRouter(canaryCredentials, [rule]);
    const resolved = await router.resolveAsync(canaryCtx);
    expect(resolved?.credentialId).toBe('cred-primary');
    expect(resolved?.isCanary).toBe(false);
  });

  it('always routes to canary when canaryWeight is 100', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99); // 99 < 100 → canary
    const rule: RoutingRule = {
      id: 'rule-full-canary',
      description: 'Full canary rollout (weight 100)',
      credentialRef: 'primary-api-slot',
      credentialKind: 'fixed',
      priority: 10,
      canaryRef: 'canary-api-slot',
      canaryWeight: 100,
    };
    const router = createRouter(canaryCredentials, [rule]);
    const resolved = await router.resolveAsync(canaryCtx);
    expect(resolved?.credentialId).toBe('cred-canary');
    expect(resolved?.isCanary).toBe(true);
    vi.restoreAllMocks();
  });
});

// ─── CredentialRouter — expiry enforcement ────────────────────────────────────

describe('CredentialRouter — expiry enforcement', () => {
  const expiryRule: RoutingRule = {
    id: 'rule-expiry-test',
    description: 'Single-credential expiry test rule',
    credentialRef: 'expiry-test-slot',
    credentialKind: 'fixed',
    priority: 10,
  };

  it('returns null when the matched credential has already expired', async () => {
    const expiredCreds: Credential[] = [{
      id: 'cred-expired',
      kind: 'fixed',
      name: 'Expired Key',
      scope: 'read:write',
      status: 'active',
      ref: 'expiry-test-slot',
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
    }];
    const router = createRouter(expiredCreds, [expiryRule]);
    expect(await router.resolveAsync(baseCtx)).toBeNull();
  });

  it('resolves successfully when credential expiry is in the future', async () => {
    const activeCreds: Credential[] = [{
      id: 'cred-future-expiry',
      kind: 'fixed',
      name: 'Valid Key',
      scope: 'read:write',
      status: 'active',
      ref: 'expiry-test-slot',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
    }];
    const router = createRouter(activeCreds, [expiryRule]);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-future-expiry');
  });

  it('resolves successfully when credential has no expiresAt set', async () => {
    const permanentCreds: Credential[] = [{
      id: 'cred-permanent',
      kind: 'fixed',
      name: 'Permanent Key',
      scope: 'read:write',
      status: 'active',
      ref: 'expiry-test-slot',
      // expiresAt intentionally omitted — never expires
    }];
    const router = createRouter(permanentCreds, [expiryRule]);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-permanent');
  });
});

// ─── CredentialRouter — readOnly scope enforcement ───────────────────────────

describe('CredentialRouter — readOnly scope enforcement', () => {
  const readOnlyRule: RoutingRule = {
    id: 'rule-readonly-test',
    description: 'readOnly gate — credential must contain "read" in scope',
    credentialRef: 'scope-test-slot',
    credentialKind: 'fixed',
    priority: 10,
    readOnly: true,
  };

  it('resolves when readOnly is true and credential scope contains "read"', async () => {
    const creds: Credential[] = [{
      id: 'cred-read-write',
      kind: 'fixed',
      name: 'Read-Write Key',
      scope: 'read:write',
      status: 'active',
      ref: 'scope-test-slot',
    }];
    const router = createRouter(creds, [readOnlyRule]);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-read-write');
  });

  it('returns null when readOnly is true but credential scope does not contain "read"', async () => {
    const creds: Credential[] = [{
      id: 'cred-write-only',
      kind: 'fixed',
      name: 'Write-Only Key',
      scope: 'write',
      status: 'active',
      ref: 'scope-test-slot',
    }];
    const router = createRouter(creds, [readOnlyRule]);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).toBeNull();
  });
});

// ─── CredentialRouter — audit logger ─────────────────────────────────────────

describe('CredentialRouter — audit logger', () => {
  it('calls logger.log() with the correct audit entry fields on resolveAsync()', async () => {
    const logSpy = vi.fn();
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules,
      logger: { log: logSpy },
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    const entry = logSpy.mock.calls[0]?.[0];
    expect(entry.credentialId).toBe(resolved?.credentialId);
    expect(entry.userId).toBe(baseCtx.userId);
    expect(entry.action).toBe(baseCtx.action);
    expect(entry.traceId).toBe(baseCtx.traceId);
  });
});

// ─── CredentialRouter — budget enforcer ──────────────────────────────────────

describe('CredentialRouter — budget enforcer', () => {
  it('resolves credential when budget check returns allowed: true', async () => {
    const mockBudgetEnforcer = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as BudgetEnforcer;
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules,
      budgetEnforcer: mockBudgetEnforcer,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(mockBudgetEnforcer.check).toHaveBeenCalledOnce();
  });

  it('returns null when budget check returns allowed: false', async () => {
    const mockBudgetEnforcer = {
      check: vi.fn().mockResolvedValue({ allowed: false, reason: 'hourly_limit' }),
    } as unknown as BudgetEnforcer;
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules,
      budgetEnforcer: mockBudgetEnforcer,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).toBeNull();
    expect(mockBudgetEnforcer.check).toHaveBeenCalledOnce();
  });
});

// ─── CredentialRouter — approval gate ────────────────────────────────────────

describe('CredentialRouter — approval gate', () => {
  const approvalPolicy: ApprovalPolicy = {
    requiredApprovers: 1,
    approvers: [{ kind: 'slack', target: '#credential-approvals' }],
  };

  const approvalRule: RoutingRule = {
    id: 'rule-approval-gate',
    description: 'High-risk operation — requires human approval before resolving',
    credentialRef: 'linear-service-account-slot',
    credentialKind: 'fixed',
    priority: 50,
    approval: approvalPolicy,
  };

  it('resolves credential when approval status is "approved"', async () => {
    const mockApprovalManager = {
      request: vi.fn().mockResolvedValue('approved'),
    } as unknown as ApprovalManager;
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules: [approvalRule],
      approvalManager: mockApprovalManager,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-linear');
    expect(mockApprovalManager.request).toHaveBeenCalledOnce();
  });

  it('returns null when approval status is "rejected"', async () => {
    const mockApprovalManager = {
      request: vi.fn().mockResolvedValue('rejected'),
    } as unknown as ApprovalManager;
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules: [approvalRule],
      approvalManager: mockApprovalManager,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).toBeNull();
    expect(mockApprovalManager.request).toHaveBeenCalledOnce();
  });

  it('resolves credential when approval status is "break_glass" (emergency override)', async () => {
    const mockApprovalManager = {
      request: vi.fn().mockResolvedValue('break_glass'),
    } as unknown as ApprovalManager;
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules: [approvalRule],
      approvalManager: mockApprovalManager,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-linear');
    expect(mockApprovalManager.request).toHaveBeenCalledOnce();
  });
});

// ─── CredentialRouter — attestation signer ───────────────────────────────────

describe('CredentialRouter — attestation signer', () => {
  it('attaches credentialAttestation when attestationSigner is configured', async () => {
    const mockSigner: AttestationSigner = {
      sign: vi.fn().mockResolvedValue('eyJhbGciOiJIUzI1NiJ9.mock-body.mock-sig'),
      verify: vi.fn().mockResolvedValue({ credentialId: 'cred-alice' }),
    };
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules,
      attestationSigner: mockSigner,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialAttestation).toBeDefined();
    expect(typeof resolved?.credentialAttestation).toBe('string');
    expect(mockSigner.sign).toHaveBeenCalledOnce();
  });

  it('leaves credentialAttestation undefined when no attestationSigner is configured', async () => {
    const router = createRouter(credentials, rules);
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialAttestation).toBeUndefined();
  });
});

// ─── CredentialRouter — matchSpiffeId rule matching ──────────────────────────

describe('CredentialRouter — matchSpiffeId rule matching', () => {
  const spiffeRule: RoutingRule = {
    id: 'rule-spiffe-restricted',
    description: 'Restricted to a specific SPIFFE workload identity',
    credentialRef: 'linear-service-account-slot',
    credentialKind: 'fixed',
    priority: 20,
    matchSpiffeId: 'spiffe://datacules.com/workload/payment-processor',
  };

  it('matches rule when context spiffeId equals matchSpiffeId', async () => {
    const router = createRouter(credentials, [spiffeRule]);
    const resolved = await router.resolveAsync({
      ...baseCtx,
      spiffeId: 'spiffe://datacules.com/workload/payment-processor',
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialId).toBe('cred-linear');
  });

  it('returns null when context spiffeId does not match matchSpiffeId', async () => {
    const router = createRouter(credentials, [spiffeRule]);
    const resolved = await router.resolveAsync({
      ...baseCtx,
      spiffeId: 'spiffe://datacules.com/workload/different-service',
    });
    expect(resolved).toBeNull();
  });
});

// ─── CredentialRouter — isSyncCapable guard ──────────────────────────────────

describe('CredentialRouter — isSyncCapable guard', () => {
  it('warns and returns null when resolve() is called on an async-only store', () => {
    const asyncOnlyStore = {
      findByRef: async (ref: string) =>
        credentials.find((c) => c.ref === ref && c.status === 'active') ?? null,
      listActive: async () => credentials.filter((c) => c.status === 'active'),
      listByKind: async (kind: Credential['kind']) =>
        credentials.filter((c) => c.kind === kind),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const router = new CredentialRouter({ store: asyncOnlyStore, rules });
    const result = router.resolve(baseCtx);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('findByRefSync')
    );
    vi.restoreAllMocks();
  });
});

// ─── createRouterWithConfig factory ──────────────────────────────────────────

describe('createRouterWithConfig factory', () => {
  it('wires attestationSigner and logger simultaneously via RouterConfig', async () => {
    const logSpy = vi.fn();
    const mockSigner: AttestationSigner = {
      sign: vi.fn().mockResolvedValue('config-factory-jwt-token'),
      verify: vi.fn().mockResolvedValue({}),
    };
    const router = createRouterWithConfig({
      store: new MemoryCredentialStore(credentials),
      rules,
      logger: { log: logSpy },
      attestationSigner: mockSigner,
    });
    const resolved = await router.resolveAsync(baseCtx);
    expect(resolved).not.toBeNull();
    expect(resolved?.credentialAttestation).toBeDefined();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(mockSigner.sign).toHaveBeenCalledOnce();
  });
});
