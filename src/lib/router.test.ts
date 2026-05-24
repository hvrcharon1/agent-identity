/**
 * Unit tests for CredentialRouter (Finding #3).
 *
 * Run with: npm test
 * Watch mode: npm run test:watch
 */
import { describe, it, expect } from 'vitest';
import { createRouter } from './router';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from './credentials';
import type { AgentRequestContext, Credential, RoutingRule } from './types';

// Helper: build a minimal valid AgentRequestContext
function ctx(overrides: Partial<AgentRequestContext> = {}): AgentRequestContext {
  return {
    userId: 'user-1',
    resourceId: 'kb-1',
    resourceKind: 'personal',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    action: 'read',
    traceId: 'trace-001',
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CredentialRouter — basic resolution', () => {
  const router = createRouter(DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES);

  it('resolves user-delegated credential for a personal resource', () => {
    const result = router.resolve(ctx({ resourceKind: 'personal' }));
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('user-delegated');
    expect(result?.resolvedFor).toBe('user-1');
  });

  it('resolves fixed credential for a shared resource', () => {
    const result = router.resolve(
      ctx({ resourceKind: 'shared', provider: 'openai', model: 'gpt-4o', action: 'write' })
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('fixed');
    expect(result?.resolvedFor).toBe('service');
  });

  it('returns null when no rule matches', () => {
    const emptyRouter = createRouter([], []);
    expect(emptyRouter.resolve(ctx())).toBeNull();
  });
});

describe('CredentialRouter — multi-field matching & priority (Finding #2)', () => {
  const creds: Credential[] = [
    {
      id: 'cred-write',
      kind: 'fixed',
      name: 'Write credential',
      scope: 'write',
      status: 'active',
      ref: 'cred-write-ref',
    },
    {
      id: 'cred-read',
      kind: 'fixed',
      name: 'Read credential',
      scope: 'read',
      status: 'active',
      ref: 'cred-read-ref',
    },
  ];

  const rules: RoutingRule[] = [
    {
      id: 'rule-write',
      description: 'Write rule — higher priority',
      credentialRef: 'cred-write-ref',
      credentialKind: 'fixed',
      priority: 20,
      matchResourceKind: 'shared',
      matchAction: 'write',
    },
    {
      id: 'rule-read',
      description: 'Read rule — lower priority',
      credentialRef: 'cred-read-ref',
      credentialKind: 'fixed',
      priority: 10,
      matchResourceKind: 'shared',
    },
  ];

  const router = createRouter(creds, rules);

  it('picks higher-priority write rule when action=write', () => {
    const result = router.resolve(ctx({ resourceKind: 'shared', action: 'write' }));
    expect(result?.credentialId).toBe('cred-write');
  });

  it('falls back to lower-priority rule when action=read', () => {
    const result = router.resolve(ctx({ resourceKind: 'shared', action: 'read' }));
    expect(result?.credentialId).toBe('cred-read');
  });

  it('falls back to read rule when action=delete (write rule does not match)', () => {
    const result = router.resolve(ctx({ resourceKind: 'shared', action: 'delete' }));
    // rule-write has matchAction:'write' so it does NOT match 'delete'
    // rule-read has no matchAction so it matches any action
    expect(result?.credentialId).toBe('cred-read');
  });
});

describe('CredentialRouter — expired credential (Finding #7)', () => {
  const expiredCreds: Credential[] = [
    {
      id: 'cred-expired',
      kind: 'fixed',
      name: 'Expired credential',
      scope: 'all',
      status: 'active',
      ref: 'expired-ref',
      expiresAt: '2020-01-01T00:00:00.000Z',
    },
  ];

  const rules: RoutingRule[] = [
    {
      id: 'rule-expired',
      description: 'Rule pointing to expired cred',
      credentialRef: 'expired-ref',
      credentialKind: 'fixed',
      priority: 10,
      matchResourceKind: 'shared',
    },
  ];

  it('returns null for an expired credential', () => {
    const router = createRouter(expiredCreds, rules);
    const result = router.resolve(ctx({ resourceKind: 'shared' }));
    expect(result).toBeNull();
  });
});

describe('CredentialRouter — revoked credential', () => {
  const revokedCreds: Credential[] = [
    {
      id: 'cred-revoked',
      kind: 'fixed',
      name: 'Revoked credential',
      scope: 'all',
      status: 'revoked',
      ref: 'revoked-ref',
    },
  ];

  const rules: RoutingRule[] = [
    {
      id: 'rule-revoked',
      description: 'Rule pointing to revoked cred',
      credentialRef: 'revoked-ref',
      credentialKind: 'fixed',
      priority: 10,
      matchResourceKind: 'shared',
    },
  ];

  it('returns null for a revoked credential', () => {
    const router = createRouter(revokedCreds, rules);
    expect(router.resolve(ctx({ resourceKind: 'shared' }))).toBeNull();
  });
});
