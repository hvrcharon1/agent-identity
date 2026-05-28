/**
 * anomaly.test.ts
 *
 * Tests for AnomalyDetector — behavioral baseline + EWMA scoring.
 * Uses a low baselineSamples (1) policy so tests don't need 20 iterations
 * to transition from the collection phase into the scoring phase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnomalyDetector } from './index';
import type { AuditLogEntry, AuditLogger, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

// ─── Fixtures ────────────────────────────────────────────────────────────────

class SpyAuditLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];
  log(entry: AuditLogEntry): void | Promise<void> {
    this.entries.push(entry);
  }
}

function makeCtx(overrides: Partial<AgentRequestContext> = {}): AgentRequestContext {
  return {
    userId: 'user-alice',
    resourceId: 'res-001',
    resourceKind: 'personal',
    provider: 'openai',
    model: 'gpt-4o',
    action: 'read',
    traceId: 'trace-abc',
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResolved(overrides: Partial<ResolvedCredential> = {}): ResolvedCredential {
  return {
    id: 'cred-001',
    kind: 'fixed',
    name: 'OpenAI test cred',
    scope: 'openai',
    status: 'active',
    ref: 'openai-slot',
    resolvedFor: 'user-alice',
    resolvedAt: new Date().toISOString(),
    provider: 'openai',
    ...overrides,
  };
}

/** Drive an agent past the collection phase into scoring. Returns the detector. */
async function primeBaseline(
  detector: AnomalyDetector,
  ctx: AgentRequestContext
): Promise<void> {
  // With baselineSamples:1, one successful observe() call transitions state.
  const resolved = makeResolved({ provider: ctx.provider });
  await detector.observe(ctx, async () => resolved);
}

// ─── Baseline collection phase ───────────────────────────────────────────────

describe('AnomalyDetector — baseline collection phase', () => {
  let logger: SpyAuditLogger;
  let detector: AnomalyDetector;

  beforeEach(() => {
    logger = new SpyAuditLogger();
    detector = new AnomalyDetector({ logger, policy: { baselineSamples: 1 } });
  });

  it('emits no events while sampleCount is below baselineSamples', async () => {
    // The very first observe() call always has sampleCount=0 < 1 → no scoring.
    const resolveFn = vi.fn(async () => makeResolved());
    await detector.observe(makeCtx(), resolveFn);
    // No anomaly audit entry should have been logged.
    expect(logger.entries.every((e) => e.action !== 'credential.anomaly')).toBe(true);
  });

  it('still calls resolveFunc during baseline collection', async () => {
    const resolveFn = vi.fn(async () => makeResolved());
    const result = await detector.observe(makeCtx(), resolveFn);
    expect(resolveFn).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
  });

  it('learns provider, action, and resourceKind from the baseline call', async () => {
    const ctx = makeCtx({ provider: 'anthropic', action: 'write', resourceKind: 'shared' });
    const resolved = makeResolved({ provider: 'anthropic' });
    await detector.observe(ctx, async () => resolved);
    // Second call with same values should produce no new_provider / new_action events.
    const onAnomaly = vi.fn();
    const detector2 = new AnomalyDetector({ logger, policy: { baselineSamples: 1 }, onAnomaly });
    await detector2.observe(ctx, async () => resolved); // prime
    onAnomaly.mockClear();
    await detector2.observe(ctx, async () => resolved); // second call — known values
    const anomalies = onAnomaly.mock.calls.map((c) => c[0].signal as string);
    expect(anomalies).not.toContain('new_provider');
    expect(anomalies).not.toContain('new_action_type');
    expect(anomalies).not.toContain('new_resource_kind');
  });
});

// ─── Scoring phase — event detection ─────────────────────────────────────────

describe('AnomalyDetector — scoring phase event detection', () => {
  let logger: SpyAuditLogger;
  let onAnomaly: ReturnType<typeof vi.fn>;
  let detector: AnomalyDetector;

  beforeEach(async () => {
    logger = new SpyAuditLogger();
    onAnomaly = vi.fn();
    detector = new AnomalyDetector({ logger, policy: { baselineSamples: 1 }, onAnomaly });
    // Prime the baseline with openai / read / personal
    await primeBaseline(detector, makeCtx());
    onAnomaly.mockClear();
    logger.entries.length = 0;
  });

  it('emits new_provider when an unknown provider is observed', async () => {
    await detector.observe(makeCtx({ provider: 'anthropic' }), async () => makeResolved({ provider: 'anthropic' }));
    const event = onAnomaly.mock.calls.find((c) => c[0].signal === 'new_provider');
    expect(event).toBeDefined();
    expect(event?.[0].observedValue).toBe('anthropic');
  });

  it('emits new_action_type when an unknown action is observed', async () => {
    await detector.observe(makeCtx({ action: 'delete' }), async () => makeResolved());
    const event = onAnomaly.mock.calls.find((c) => c[0].signal === 'new_action_type');
    expect(event).toBeDefined();
    expect(event?.[0].observedValue).toBe('delete');
  });

  it('emits new_resource_kind when an unknown resource kind is observed', async () => {
    await detector.observe(makeCtx({ resourceKind: 'shared' }), async () => makeResolved());
    const event = onAnomaly.mock.calls.find((c) => c[0].signal === 'new_resource_kind');
    expect(event).toBeDefined();
    expect(event?.[0].observedValue).toBe('shared');
  });

  it('emits no events when all values match the established baseline', async () => {
    // Same ctx as the primeBaseline call — all values known.
    await detector.observe(makeCtx(), async () => makeResolved());
    const anomalyEvents = onAnomaly.mock.calls.filter(
      (c) => c[0].signal !== 'rate_spike' // rate_spike depends on EWMA timing, exclude
    );
    expect(anomalyEvents).toHaveLength(0);
  });

  it('emits rate_spike when call rate exceeds ewmaRatePerHour * threshold', async () => {
    // After primeBaseline: ewmaRatePerHour = callsThisHour at that point = 1.
    // Next call: callsThisHour increments to 2. With rateSpikeThreshold=1.1: 2 > 1.1 → spike.
    const fastDetector = new AnomalyDetector({
      logger,
      onAnomaly,
      policy: { baselineSamples: 1, rateSpikeThreshold: 1.1 },
    });
    await primeBaseline(fastDetector, makeCtx()); // call 1: ewma set to 1
    onAnomaly.mockClear();
    await fastDetector.observe(makeCtx(), async () => makeResolved()); // call 2: rate=2 > 1*1.1
    const spike = onAnomaly.mock.calls.find((c) => c[0].signal === 'rate_spike');
    expect(spike).toBeDefined();
    expect(spike?.[0].severity).toBe('high');
  });
});

// ─── Policy actions ───────────────────────────────────────────────────────────

describe('AnomalyDetector — policy actions', () => {
  let logger: SpyAuditLogger;

  beforeEach(() => {
    logger = new SpyAuditLogger();
  });

  it('returns null and skips resolveFunc when highAction = block and high severity fires', async () => {
    const detector = new AnomalyDetector({
      logger,
      policy: { baselineSamples: 1, rateSpikeThreshold: 1.1, highAction: 'block' },
    });
    await primeBaseline(detector, makeCtx()); // ewma = 1
    const resolveFn = vi.fn(async () => makeResolved());
    // Second call triggers rate_spike (high), policy = block → returns null
    const result = await detector.observe(makeCtx(), resolveFn);
    expect(result).toBeNull();
    expect(resolveFn).not.toHaveBeenCalled();
  });

  it('continues resolving when highAction = warn despite anomaly', async () => {
    const detector = new AnomalyDetector({
      logger,
      policy: { baselineSamples: 1, rateSpikeThreshold: 1.1, highAction: 'warn' },
    });
    await primeBaseline(detector, makeCtx());
    const resolveFn = vi.fn(async () => makeResolved());
    const result = await detector.observe(makeCtx(), resolveFn);
    // warn → resolution continues despite rate spike
    expect(resolveFn).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
  });
});

// ─── Audit logger integration ─────────────────────────────────────────────────

describe('AnomalyDetector — audit logger integration', () => {
  let logger: SpyAuditLogger;
  let detector: AnomalyDetector;

  beforeEach(async () => {
    logger = new SpyAuditLogger();
    detector = new AnomalyDetector({ logger, policy: { baselineSamples: 1 } });
    await primeBaseline(detector, makeCtx());
    logger.entries.length = 0;
  });

  it('logger.log() is called with action = credential.anomaly', async () => {
    await detector.observe(makeCtx({ provider: 'anthropic' }), async () => makeResolved());
    const anomalyEntry = logger.entries.find((e) => e.action === 'credential.anomaly');
    expect(anomalyEntry).toBeDefined();
  });

  it('audit entry includes signal and severity fields', async () => {
    await detector.observe(makeCtx({ provider: 'anthropic' }), async () => makeResolved());
    const entry = logger.entries.find((e) => e.action === 'credential.anomaly') as AuditLogEntry & Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry?.signal).toBe('new_provider');
    expect(entry?.severity).toBe('low');
  });

  it('onAnomaly callback is invoked for each anomaly event', async () => {
    const cb = vi.fn();
    const d = new AnomalyDetector({ logger, policy: { baselineSamples: 1 }, onAnomaly: cb });
    await primeBaseline(d, makeCtx());
    cb.mockClear();
    await d.observe(makeCtx({ provider: 'anthropic', action: 'delete' }), async () => makeResolved());
    // Two anomalies: new_provider + new_action_type
    expect(cb).toHaveBeenCalledTimes(2);
    const signals = cb.mock.calls.map((c) => c[0].signal as string);
    expect(signals).toContain('new_provider');
    expect(signals).toContain('new_action_type');
  });
});

// ─── Baseline management ──────────────────────────────────────────────────────

describe('AnomalyDetector — baseline management', () => {
  let logger: SpyAuditLogger;

  beforeEach(() => {
    logger = new SpyAuditLogger();
  });

  it('resetBaseline() restores collecting state — next call emits no events', async () => {
    const onAnomaly = vi.fn();
    const detector = new AnomalyDetector({ logger, policy: { baselineSamples: 1 }, onAnomaly });
    await primeBaseline(detector, makeCtx()); // baseline ready
    detector.resetBaseline('user-alice');
    onAnomaly.mockClear();
    // After reset, sampleCount=0 again → collection phase → no scoring
    await detector.observe(makeCtx({ provider: 'anthropic' }), async () => makeResolved());
    const anomalySignals = onAnomaly.mock.calls.map((c) => c[0].signal as string);
    expect(anomalySignals).not.toContain('new_provider');
  });

  it('two agents with different userIds have independent baselines', async () => {
    const onAnomaly = vi.fn();
    const detector = new AnomalyDetector({ logger, policy: { baselineSamples: 1 }, onAnomaly });
    // Prime alice with openai
    await primeBaseline(detector, makeCtx({ userId: 'user-alice', provider: 'openai' }));
    // Prime bob with anthropic
    await primeBaseline(detector, makeCtx({ userId: 'user-bob', provider: 'anthropic' }));
    onAnomaly.mockClear();

    // alice sees anthropic as new
    await detector.observe(
      makeCtx({ userId: 'user-alice', provider: 'anthropic' }),
      async () => makeResolved({ provider: 'anthropic' })
    );
    // bob sees openai as new
    await detector.observe(
      makeCtx({ userId: 'user-bob', provider: 'openai' }),
      async () => makeResolved({ provider: 'openai' })
    );

    const aliceEvents = onAnomaly.mock.calls.filter((c) => c[0].userId === 'user-alice');
    const bobEvents   = onAnomaly.mock.calls.filter((c) => c[0].userId === 'user-bob');
    expect(aliceEvents.some((c) => c[0].signal === 'new_provider')).toBe(true);
    expect(bobEvents.some((c) => c[0].signal === 'new_provider')).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('AnomalyDetector — edge cases', () => {
  it('baseline is not updated when resolveFunc returns null', async () => {
    const logger = new SpyAuditLogger();
    const onAnomaly = vi.fn();
    const detector = new AnomalyDetector({
      logger,
      policy: { baselineSamples: 1 },
      onAnomaly,
    });
    // Prime — but resolveFunc returns null (no credential matched)
    await detector.observe(makeCtx({ provider: 'openai' }), async () => null);
    // sampleCount was NOT incremented (updateBaseline skipped)
    // So a second call is still in collection phase
    onAnomaly.mockClear();
    await detector.observe(makeCtx({ provider: 'anthropic' }), async () => null);
    // Should still be collecting (sampleCount=0 still) → no new_provider event
    const newProviderCalls = onAnomaly.mock.calls.filter((c) => c[0].signal === 'new_provider');
    expect(newProviderCalls).toHaveLength(0);
  });
});
