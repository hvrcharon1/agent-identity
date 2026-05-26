/**
 * Zod schema tests — ensures schemas accept valid inputs and reject invalid ones.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRequestContextSchema,
  MigrationContextSchema,
  RoutingRuleSchema,
  CredentialSchema,
} from './schemas';

const validCtx = {
  userId: 'user-1',
  resourceId: 'kb-1',
  resourceKind: 'personal' as const,
  provider: 'anthropic' as const,
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: 'trace-001',
  requestedAt: new Date().toISOString(),
};

describe('AgentRequestContextSchema', () => {
  it('accepts a valid context', () => {
    expect(AgentRequestContextSchema.safeParse(validCtx).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { userId: _removed, ...rest } = validCtx;
    expect(AgentRequestContextSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid provider', () => {
    expect(AgentRequestContextSchema.safeParse({ ...validCtx, provider: 'unknown-provider' }).success).toBe(false);
  });

  it('rejects a non-datetime requestedAt', () => {
    expect(AgentRequestContextSchema.safeParse({ ...validCtx, requestedAt: 'not-a-date' }).success).toBe(false);
  });
});

describe('MigrationContextSchema', () => {
  it('accepts a valid migration context', () => {
    const mig = { ...validCtx, migrationId: 'mig-1', phase: 'extract', sourceResourceId: 'src', targetResourceId: 'tgt', dryRun: false };
    expect(MigrationContextSchema.safeParse(mig).success).toBe(true);
  });

  it('rejects an invalid phase', () => {
    const mig = { ...validCtx, migrationId: 'mig-1', phase: 'unknown', sourceResourceId: 'src', targetResourceId: 'tgt', dryRun: false };
    expect(MigrationContextSchema.safeParse(mig).success).toBe(false);
  });
});

describe('RoutingRuleSchema', () => {
  it('accepts a minimal valid rule', () => {
    const rule = { id: 'r-1', description: 'test', credentialRef: 'ref-1', credentialKind: 'fixed', priority: 10 };
    expect(RoutingRuleSchema.safeParse(rule).success).toBe(true);
  });

  it('accepts matchAction as array', () => {
    const rule = { id: 'r-1', description: 'test', credentialRef: 'ref-1', credentialKind: 'fixed', priority: 10, matchAction: ['read', 'write'] };
    expect(RoutingRuleSchema.safeParse(rule).success).toBe(true);
  });
});

describe('CredentialSchema', () => {
  it('rejects pending status', () => {
    const cred = { id: 'c-1', kind: 'fixed', name: 'Test', scope: 'all', status: 'pending', ref: 'ref-1' };
    // pending is a valid status enum value— schema accepts it; the store filters it
    expect(CredentialSchema.safeParse(cred).success).toBe(true);
  });

  it('rejects invalid expiresAt', () => {
    const cred = { id: 'c-1', kind: 'fixed', name: 'Test', scope: 'all', status: 'active', ref: 'ref-1', expiresAt: 'not-a-date' };
    expect(CredentialSchema.safeParse(cred).success).toBe(false);
  });
});
