/**
 * otel.test.ts
 *
 * Vitest unit tests for @datacules/agent-identity-otel.
 *
 * Verifies that withOtel() wraps every resolution method with correct
 * span naming, attribute setting, error recording, and span.end() cleanup.
 *
 * The mock tracer and span are plain objects with vi.fn() methods.
 * No @opentelemetry/api runtime dependency is needed because the source
 * file only uses `import type` from that package — type imports are erased
 * entirely by TypeScript and never appear in the compiled output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withOtel } from './index';
import type {
  AgentRequestContext,
  MigrationContext,
  ResolvedCredential,
  ResolvedCredentialPair,
} from '@datacules/agent-identity';

// ─── Mock OTEL span + tracer ──────────────────────────────────────────────────

function makeMockSpan() {
  return {
    setAttribute:    vi.fn(),
    setStatus:       vi.fn(),
    recordException: vi.fn(),
    end:             vi.fn(),
  };
}

type MockSpan = ReturnType<typeof makeMockSpan>;

function makeMockTracer(span: MockSpan) {
  return { startSpan: vi.fn(() => span) };
}

// ─── Mock router ───────────────────────────────────────────────────────────────

function makeBaseRouter(overrides: {
  resolve?:          (ctx: AgentRequestContext)  => ResolvedCredential | null;
  resolveAsync?:     (ctx: AgentRequestContext)  => Promise<ResolvedCredential | null>;
  resolvePair?:      (ctx: MigrationContext)     => ResolvedCredentialPair | null;
  resolvePairAsync?: (ctx: MigrationContext)     => Promise<ResolvedCredentialPair | null>;
} = {}) {
  return {
    resolve:          vi.fn(overrides.resolve          ?? (() => null)),
    resolveAsync:     vi.fn(overrides.resolveAsync     ?? (async () => null)),
    resolvePair:      vi.fn(overrides.resolvePair      ?? (() => null)),
    resolvePairAsync: vi.fn(overrides.resolvePairAsync ?? (async () => null)),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<AgentRequestContext> = {}): AgentRequestContext {
  return {
    userId:       'user-alice',
    resourceId:   'res-001',
    resourceKind: 'personal',
    provider:     'openai',
    model:        'gpt-4o',
    action:       'read',
    traceId:      'trace-abc',
    requestedAt:  new Date().toISOString(),
    ...overrides,
  };
}

function makeMigCtx(overrides: Partial<MigrationContext> = {}): MigrationContext {
  return {
    ...makeCtx(),
    migrationId:      'mig-001',
    phase:            'extract',
    sourceResourceId: 'src-001',
    targetResourceId: 'tgt-001',
    dryRun:           false,
    ...overrides,
  };
}

function makeResolved(): ResolvedCredential {
  return {
    credentialId: 'cred-001',
    kind:         'fixed',
    ref:          'openai-slot',
    resolvedFor:  'service',
    isCanary:     false,
  };
}

function makeResolvedPair(): ResolvedCredentialPair {
  return {
    source:      makeResolved(),
    target:      { ...makeResolved(), credentialId: 'cred-002' },
    migrationId: 'mig-001',
  };
}

// ─── withOtel — resolve() ─────────────────────────────────────────────────────

describe('withOtel — resolve()', () => {
  let span:   MockSpan;
  let tracer: ReturnType<typeof makeMockTracer>;

  beforeEach(() => {
    span   = makeMockSpan();
    tracer = makeMockTracer(span);
  });

  it('starts a span named agent-identity.resolve', () => {
    const traced = withOtel(makeBaseRouter(), { tracer: tracer as never });
    traced.resolve(makeCtx());
    expect(tracer.startSpan).toHaveBeenCalledWith('agent-identity.resolve');
  });

  it('sets standard context attributes on the span', () => {
    const traced = withOtel(makeBaseRouter(), { tracer: tracer as never });
    traced.resolve(makeCtx());
    expect(span.setAttribute).toHaveBeenCalledWith('agent.provider',          'openai');
    expect(span.setAttribute).toHaveBeenCalledWith('agent.model',             'gpt-4o');
    expect(span.setAttribute).toHaveBeenCalledWith('agent.action',            'read');
    expect(span.setAttribute).toHaveBeenCalledWith('credential.resource_id',  'res-001');
    expect(span.setAttribute).toHaveBeenCalledWith('agent.user_id',           'user-alice');
    expect(span.setAttribute).toHaveBeenCalledWith('trace.id',                'trace-abc');
  });

  it('sets routing.resolved=true and credential attributes on a successful resolve', () => {
    const resolved = makeResolved();
    const traced   = withOtel(
      makeBaseRouter({ resolve: () => resolved }),
      { tracer: tracer as never }
    );
    traced.resolve(makeCtx());
    expect(span.setAttribute).toHaveBeenCalledWith('routing.resolved', true);
    expect(span.setAttribute).toHaveBeenCalledWith('credential.id',   'cred-001');
    expect(span.setAttribute).toHaveBeenCalledWith('credential.kind', 'fixed');
    expect(span.setAttribute).toHaveBeenCalledWith('routing.canary',  false);
  });

  it('sets routing.resolved=false when the router returns null', () => {
    const traced = withOtel(
      makeBaseRouter({ resolve: () => null }),
      { tracer: tracer as never }
    );
    traced.resolve(makeCtx());
    expect(span.setAttribute).toHaveBeenCalledWith('routing.resolved', false);
  });

  it('records the exception and ends the span even when router.resolve() throws', () => {
    const traced = withOtel(
      makeBaseRouter({ resolve: () => { throw new Error('store error'); } }),
      { tracer: tracer as never }
    );
    expect(() => traced.resolve(makeCtx())).toThrow('store error');
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});

// ─── withOtel — resolveAsync() ────────────────────────────────────────────────

describe('withOtel — resolveAsync()', () => {
  let span:   MockSpan;
  let tracer: ReturnType<typeof makeMockTracer>;

  beforeEach(() => {
    span   = makeMockSpan();
    tracer = makeMockTracer(span);
  });

  it('starts a span named agent-identity.resolve_async', async () => {
    const traced = withOtel(makeBaseRouter(), { tracer: tracer as never });
    await traced.resolveAsync(makeCtx());
    expect(tracer.startSpan).toHaveBeenCalledWith('agent-identity.resolve_async');
  });

  it('awaits the router result and propagates routing.resolved=true', async () => {
    const resolved = makeResolved();
    const traced   = withOtel(
      makeBaseRouter({ resolveAsync: async () => resolved }),
      { tracer: tracer as never }
    );
    const result = await traced.resolveAsync(makeCtx());
    expect(result).toStrictEqual(resolved);
    expect(span.setAttribute).toHaveBeenCalledWith('routing.resolved', true);
  });

  it('records exception and ends span when resolveAsync rejects', async () => {
    const traced = withOtel(
      makeBaseRouter({ resolveAsync: async () => { throw new Error('async error'); } }),
      { tracer: tracer as never }
    );
    await expect(traced.resolveAsync(makeCtx())).rejects.toThrow('async error');
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});

// ─── withOtel — resolvePair() ─────────────────────────────────────────────────

describe('withOtel — resolvePair()', () => {
  let span:   MockSpan;
  let tracer: ReturnType<typeof makeMockTracer>;

  beforeEach(() => {
    span   = makeMockSpan();
    tracer = makeMockTracer(span);
  });

  it('starts a span and sets migration context attributes', () => {
    const traced = withOtel(makeBaseRouter(), { tracer: tracer as never });
    const ctx    = makeMigCtx({ migrationId: 'mig-42', phase: 'load', dryRun: true });
    traced.resolvePair(ctx);
    expect(tracer.startSpan).toHaveBeenCalledWith('agent-identity.resolve_pair');
    expect(span.setAttribute).toHaveBeenCalledWith('migration.id',       'mig-42');
    expect(span.setAttribute).toHaveBeenCalledWith('migration.phase',     'load');
    expect(span.setAttribute).toHaveBeenCalledWith('migration.dry_run',   true);
  });

  it('sets routing.resolved=true when a pair is returned', () => {
    const pair   = makeResolvedPair();
    const traced = withOtel(
      makeBaseRouter({ resolvePair: () => pair }),
      { tracer: tracer as never }
    );
    const result = traced.resolvePair(makeMigCtx());
    expect(result).toStrictEqual(pair);
    expect(span.setAttribute).toHaveBeenCalledWith('routing.resolved', true);
  });

  it('ends the span even when router.resolvePair() throws', () => {
    const traced = withOtel(
      makeBaseRouter({ resolvePair: () => { throw new Error('pair error'); } }),
      { tracer: tracer as never }
    );
    expect(() => traced.resolvePair(makeMigCtx())).toThrow('pair error');
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});

// ─── withOtel — resolvePairAsync() ───────────────────────────────────────────

describe('withOtel — resolvePairAsync()', () => {
  let span:   MockSpan;
  let tracer: ReturnType<typeof makeMockTracer>;

  beforeEach(() => {
    span   = makeMockSpan();
    tracer = makeMockTracer(span);
  });

  it('starts a span named agent-identity.resolve_pair_async', async () => {
    const traced = withOtel(makeBaseRouter(), { tracer: tracer as never });
    await traced.resolvePairAsync(makeMigCtx());
    expect(tracer.startSpan).toHaveBeenCalledWith('agent-identity.resolve_pair_async');
  });

  it('sets routing.resolved=false when null is returned', async () => {
    const traced = withOtel(
      makeBaseRouter({ resolvePairAsync: async () => null }),
      { tracer: tracer as never }
    );
    const result = await traced.resolvePairAsync(makeMigCtx());
    expect(result).toBeNull();
    expect(span.setAttribute).toHaveBeenCalledWith('routing.resolved', false);
  });

  it('records exception and ends span on rejection', async () => {
    const traced = withOtel(
      makeBaseRouter({ resolvePairAsync: async () => { throw new Error('pair async err'); } }),
      { tracer: tracer as never }
    );
    await expect(traced.resolvePairAsync(makeMigCtx())).rejects.toThrow('pair async err');
    expect(span.recordException).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
