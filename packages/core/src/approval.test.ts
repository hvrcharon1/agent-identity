/**
 * approval.test.ts — updated to use the canonical ApprovalPolicy type
 * (requiredApprovers: number, approvers: Approver[]) from types.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemoryApprovalStore,
  ApprovalManager,
} from './approval';
import type { AgentRequestContext, ApprovalPolicy, AuditLogEntry, AuditLogger } from './types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ctx: AgentRequestContext = {
  userId: 'user-alice',
  resourceId: 'sensitive-db',
  resourceKind: 'shared',
  provider: 'openai',
  model: 'gpt-4o',
  action: 'write',
  traceId: 'trace-xyz',
  requestedAt: new Date().toISOString(),
};

// Canonical ApprovalPolicy — matches types.ts (requiredApprovers + Approver[])
const policy: ApprovalPolicy = {
  requiredApprovers: 1,
  approvers: [{ kind: 'webhook', target: 'https://approvals.example.com/hook' }],
  timeoutSeconds: 300,
};

class SpyAuditLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];
  log(entry: AuditLogEntry): void { this.entries.push(entry); }
}

// ─── MemoryApprovalStore ──────────────────────────────────────────────────────

describe('MemoryApprovalStore', () => {
  let store: MemoryApprovalStore;

  beforeEach(() => { store = new MemoryApprovalStore(); });

  it('get() returns null for an unknown request', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('create() then get() returns the request', async () => {
    const req = {
      requestId: 'req-1',
      credentialId: 'cred-1',
      ruleId: 'rule-1',
      context: ctx,
      status: 'pending' as const,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    await store.create(req);
    const fetched = await store.get('req-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.credentialId).toBe('cred-1');
    expect(fetched?.status).toBe('pending');
  });

  it('update() changes status and sets resolvedAt', async () => {
    const req = {
      requestId: 'req-2', credentialId: 'cred-2', ruleId: 'rule-2', context: ctx,
      status: 'pending' as const, requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    await store.create(req);
    await store.update('req-2', 'approved', 'admin@example.com');
    const updated = await store.get('req-2');
    expect(updated?.status).toBe('approved');
    expect(updated?.resolvedBy).toBe('admin@example.com');
    expect(updated?.resolvedAt).toBeDefined();
  });

  it('listPending() returns only pending requests', async () => {
    await store.create({ requestId: 'r1', credentialId: 'c1', ruleId: 'rule', context: ctx,
      status: 'pending', requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await store.create({ requestId: 'r2', credentialId: 'c2', ruleId: 'rule', context: ctx,
      status: 'pending', requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await store.update('r2', 'approved');
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe('r1');
  });
});

// ─── ApprovalManager ──────────────────────────────────────────────────────────

describe('ApprovalManager', () => {
  let store: MemoryApprovalStore;
  let logger: SpyAuditLogger;
  let manager: ApprovalManager;

  beforeEach(() => {
    store = new MemoryApprovalStore();
    logger = new SpyAuditLogger();
    manager = new ApprovalManager(store, [], logger);
  });

  it('returns pending on first request and creates the request', async () => {
    const status = await manager.request(ctx, policy, 'cred-1', 'rule-1');
    expect(status).toBe('pending');
    const req = await store.get('approval-trace-xyz-rule-1');
    expect(req).not.toBeNull();
    expect(req?.credentialId).toBe('cred-1');
  });

  it('emits credential.approval_requested audit event', async () => {
    await manager.request(ctx, policy, 'cred-1', 'rule-1');
    const event = logger.entries.find((e) => e.action === 'credential.approval_requested');
    expect(event).toBeDefined();
    expect(event?.credentialId).toBe('cred-1');
    expect(event?.traceId).toBe('trace-xyz');
  });

  it('is idempotent — second call returns pending without creating a duplicate', async () => {
    await manager.request(ctx, policy, 'cred-1', 'rule-1');
    const second = await manager.request(ctx, policy, 'cred-1', 'rule-1');
    expect(second).toBe('pending');
    const events = logger.entries.filter((e) => e.action === 'credential.approval_requested');
    expect(events).toHaveLength(1);
  });

  it('returns approved once the request is approved', async () => {
    await manager.request(ctx, policy, 'cred-1', 'rule-1');
    await store.update('approval-trace-xyz-rule-1', 'approved', 'admin@example.com');
    const status = await manager.request(ctx, policy, 'cred-1', 'rule-1');
    expect(status).toBe('approved');
  });

  it('returns rejected once the request is rejected', async () => {
    await manager.request(ctx, policy, 'cred-1', 'rule-1');
    await store.update('approval-trace-xyz-rule-1', 'rejected', 'admin@example.com');
    const status = await manager.request(ctx, policy, 'cred-1', 'rule-1');
    expect(status).toBe('rejected');
  });

  it('returns timeout and emits audit event when the request has expired', async () => {
    await manager.request(ctx, policy, 'cred-1', 'rule-expire');
    const requestId = 'approval-trace-xyz-rule-expire';
    // Directly mutate the stored entry to simulate expiry
    const stored = await store.get(requestId);
    if (stored) {
      await store.create({ ...stored, expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'pending' });
    }
    const status = await manager.request(ctx, policy, 'cred-1', 'rule-expire');
    expect(status).toBe('timeout');
    const event = logger.entries.find((e) => e.action === 'credential.approval_timeout');
    expect(event).toBeDefined();
  });

  it('calls all notifiers on first request creation', async () => {
    const notifierA = { notify: vi.fn().mockResolvedValue(undefined) };
    const notifierB = { notify: vi.fn().mockResolvedValue(undefined) };
    const mgr = new ApprovalManager(store, [notifierA, notifierB], logger);
    await mgr.request(ctx, policy, 'cred-1', 'rule-fan');
    expect(notifierA.notify).toHaveBeenCalledOnce();
    expect(notifierB.notify).toHaveBeenCalledOnce();
  });

  it('does not call notifiers on subsequent calls for the same requestId', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const mgr = new ApprovalManager(store, [notifier], logger);
    await mgr.request(ctx, policy, 'cred-1', 'rule-1');
    await mgr.request(ctx, policy, 'cred-1', 'rule-1');
    expect(notifier.notify).toHaveBeenCalledOnce();
  });

  it('works without an audit logger', async () => {
    const mgr = new ApprovalManager(store, []);
    await expect(mgr.request(ctx, policy, 'cred-1', 'rule-1')).resolves.toBe('pending');
  });
});
