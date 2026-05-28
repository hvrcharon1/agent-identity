/**
 * budget.test.ts
 *
 * Tests for MemoryBudgetStore and BudgetEnforcer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryBudgetStore, BudgetEnforcer } from './budget';
import type { Credential, AuditLogEntry, AuditLogger } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-openai',
    kind: 'fixed',
    name: 'OpenAI Production',
    scope: 'read:write',
    status: 'active',
    provider: 'openai',
    ref: 'openai-prod-slot',
    ...overrides,
  };
}

class SpyAuditLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];
  log(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }
}

// ─── MemoryBudgetStore ────────────────────────────────────────────────────────

describe('MemoryBudgetStore', () => {
  let store: MemoryBudgetStore;

  beforeEach(() => {
    store = new MemoryBudgetStore();
  });

  it('starts with zero hourly count', async () => {
    expect(await store.getHourlyCount('cred-1')).toBe(0);
  });

  it('increments hourly count correctly', async () => {
    await store.incrementHourlyCount('cred-1');
    await store.incrementHourlyCount('cred-1');
    await store.incrementHourlyCount('cred-1');
    expect(await store.getHourlyCount('cred-1')).toBe(3);
  });

  it('tracks different credential IDs independently', async () => {
    await store.incrementHourlyCount('cred-a');
    await store.incrementHourlyCount('cred-a');
    await store.incrementHourlyCount('cred-b');
    expect(await store.getHourlyCount('cred-a')).toBe(2);
    expect(await store.getHourlyCount('cred-b')).toBe(1);
  });

  it('resetHourly clears the count', async () => {
    await store.incrementHourlyCount('cred-1');
    await store.incrementHourlyCount('cred-1');
    await store.resetHourly('cred-1');
    expect(await store.getHourlyCount('cred-1')).toBe(0);
  });

  it('getDailySpend returns 0 for unknown credential', async () => {
    expect(await store.getDailySpend('unknown')).toBe(0);
  });

  it('resetDaily does not throw for unknown credential', async () => {
    await expect(store.resetDaily('unknown')).resolves.not.toThrow();
  });
});

// ─── BudgetEnforcer ───────────────────────────────────────────────────────────

describe('BudgetEnforcer', () => {
  let store: MemoryBudgetStore;
  let logger: SpyAuditLogger;
  let enforcer: BudgetEnforcer;

  beforeEach(() => {
    store = new MemoryBudgetStore();
    logger = new SpyAuditLogger();
    enforcer = new BudgetEnforcer(store, logger);
  });

  it('allows resolution when no budget policy is set', async () => {
    const cred = makeCredential(); // no budget field
    const result = await enforcer.check(cred);
    expect(result.allowed).toBe(true);
  });

  it('allows resolution when hourly count is below the limit', async () => {
    const cred = makeCredential({
      budget: { maxResolutionsPerHour: 10, softThresholdPercent: 80 },
    });
    const result = await enforcer.check(cred);
    expect(result.allowed).toBe(true);
  });

  it('blocks and returns 429 when hourly limit is reached', async () => {
    const cred = makeCredential({
      budget: { maxResolutionsPerHour: 2, softThresholdPercent: 80 },
    });
    // Reach the limit manually
    await store.incrementHourlyCount(cred.id);
    await store.incrementHourlyCount(cred.id);

    const result = await enforcer.check(cred);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.retryAfter).toBeDefined();
  });

  it('emits budget_exceeded audit event when limit is hit', async () => {
    const cred = makeCredential({
      budget: { maxResolutionsPerHour: 1, softThresholdPercent: 80 },
    });
    await store.incrementHourlyCount(cred.id); // already at limit

    await enforcer.check(cred);

    // Wait for the fire-and-forget audit log (it's synchronous in MemoryBudgetStore)
    await vi.waitFor(() => expect(logger.entries.length).toBeGreaterThan(0));
    const event = logger.entries.find((e) => e.action === 'credential.budget_exceeded');
    expect(event).toBeDefined();
    expect(event?.credentialId).toBe(cred.id);
  });

  it('emits budget_warning audit event at soft threshold', async () => {
    const cred = makeCredential({
      budget: { maxResolutionsPerHour: 10, softThresholdPercent: 80 },
    });
    // Drive count to exactly the soft threshold (8 of 10)
    for (let i = 0; i < 8; i++) {
      await store.incrementHourlyCount(cred.id);
    }

    const result = await enforcer.check(cred);
    expect(result.allowed).toBe(true);

    await vi.waitFor(() => expect(logger.entries.length).toBeGreaterThan(0));
    const warning = logger.entries.find((e) => e.action === 'credential.budget_warning');
    expect(warning).toBeDefined();
  });

  it('blocks when concurrent session limit is reached', async () => {
    // Override getConcurrentSessions to simulate a full session pool
    vi.spyOn(store, 'getConcurrentSessions').mockResolvedValue(5);

    const cred = makeCredential({
      budget: { maxConcurrentSessions: 5 },
    });
    const result = await enforcer.check(cred);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('session_limit');
  });

  it('increments hourly count after a successful check', async () => {
    const cred = makeCredential({
      budget: { maxResolutionsPerHour: 100 },
    });
    const before = await store.getHourlyCount(cred.id);
    await enforcer.check(cred);
    const after = await store.getHourlyCount(cred.id);
    expect(after).toBe(before + 1);
  });

  it('works without an audit logger (no-throw)', async () => {
    const enforcerNoLog = new BudgetEnforcer(store);
    const cred = makeCredential({ budget: { maxResolutionsPerHour: 1 } });
    await store.incrementHourlyCount(cred.id); // at limit
    await expect(enforcerNoLog.check(cred)).resolves.not.toThrow();
  });
});
