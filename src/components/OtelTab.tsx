'use client';

import { useState } from 'react';

type SpanState = 'idle' | 'running' | 'done';

interface EmittedSpan {
  name: string;
  durationMs: number;
  resolved: boolean;
  attributes: Record<string, string | boolean | number>;
}

const BACKENDS = [
  { id: 'datadog',  label: 'Datadog APM',     note: 'Spans nest under your existing APM service traces.' },
  { id: 'honeycomb', label: 'Honeycomb',       note: 'Full attribute set queryable in Honeycomb columns.' },
  { id: 'jaeger',   label: 'Jaeger',           note: 'Trace propagated via W3C traceparent header.' },
  { id: 'xray',     label: 'AWS X-Ray',        note: 'Spans appear as subsegments of your Lambda traces.' },
];

const SPAN_TABLE = [
  { name: 'agent_identity.resolve',            desc: 'Synchronous credential resolution' },
  { name: 'agent_identity.resolve_async',      desc: 'Async resolution — includes budget, approval, attestation' },
  { name: 'agent_identity.resolve_pair',       desc: 'Migration dual-credential resolution (sync)' },
  { name: 'agent_identity.resolve_pair_async', desc: 'Migration dual-credential resolution (async)' },
];

const ATTRS = [
  { attr: 'agent.user_id',              example: 'user-abc' },
  { attr: 'agent.provider',             example: 'anthropic' },
  { attr: 'agent.model',                example: 'claude-sonnet-4-20250514' },
  { attr: 'agent.action',               example: 'read' },
  { attr: 'credential.resource_id',     example: 'knowledge-base' },
  { attr: 'credential.resource_kind',   example: 'personal' },
  { attr: 'credential.id',              example: 'cred-anthropic-api' },
  { attr: 'credential.kind',            example: 'user-delegated' },
  { attr: 'routing.resolved',           example: 'true' },
  { attr: 'routing.canary',             example: 'false' },
  { attr: 'routing.resolved_for',       example: 'user-abc' },
  { attr: 'trace.id',                   example: 'trace-9f4a…' },
];

export function OtelTab() {
  const [spanState, setSpanState] = useState<SpanState>('idle');
  const [spans, setSpans] = useState<EmittedSpan[]>([]);
  const [activeBackend, setActiveBackend] = useState('datadog');

  const simulate = async () => {
    if (spanState !== 'idle') return;
    setSpanState('running');
    setSpans([]);

    await new Promise((r) => setTimeout(r, 400));
    setSpans((s) => [
      ...s,
      {
        name: 'agent_identity.store.get',
        durationMs: 3,
        resolved: true,
        attributes: { 'store.type': 'MemoryCredentialStore', 'store.latency_ms': 3 },
      },
    ]);

    await new Promise((r) => setTimeout(r, 500));
    setSpans((s) => [
      ...s,
      {
        name: 'agent_identity.resolve_async',
        durationMs: 18,
        resolved: true,
        attributes: {
          'agent.user_id': 'user-abc',
          'agent.provider': 'anthropic',
          'credential.id': 'cred-anthropic-api',
          'routing.resolved': true,
          'routing.canary': false,
        },
      },
    ]);

    await new Promise((r) => setTimeout(r, 400));
    setSpans((s) => [
      ...s,
      {
        name: 'agent_identity.audit.emit',
        durationMs: 1,
        resolved: true,
        attributes: { 'audit.sink': 'ConsoleAuditLogger', 'audit.action': 'credential.resolved' },
      },
    ]);

    setSpanState('done');
  };

  const resetSim = () => {
    setSpanState('idle');
    setSpans([]);
  };

  const snippet = `import { createRouter } from '@datacules/agent-identity';
import { withOtel } from '@datacules/agent-identity-otel';
import { trace } from '@opentelemetry/api';

const base = createRouter(credentials, rules, logger);

// Wrap once — all resolve() calls now emit spans automatically
const router = withOtel(base, {
  tracer:        trace.getTracer('my-agent-service'),
  serviceName:   'agent-identity',   // prefix on every span name
  includeUserId: true,               // set to false to omit PII from spans
});

// router.resolveAsync(ctx)  →  emits agent_identity.resolve_async span
// router.resolve(ctx)       →  emits agent_identity.resolve span
// router.resolvePairAsync() →  emits agent_identity.resolve_pair_async span`;

  const activeBackendInfo = BACKENDS.find((b) => b.id === activeBackend)!;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">OpenTelemetry Tracing</h2>
        <p className="text-sm text-gray-500">
          <code className="text-xs bg-gray-100 px-1 rounded">withOtel()</code> from{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">@datacules/agent-identity-otel</code> wraps any{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CredentialRouter</code> and emits OTEL spans on every
          resolution — zero changes to existing code, zero overhead when the package is absent.
          Auth spans nest inside your existing application traces in any OTEL-compatible backend.
        </p>
      </div>

      {/* Live span emitter */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Live span emitter</div>
        <div className="flex gap-2 mb-3">
          <button
            onClick={simulate}
            disabled={spanState !== 'idle'}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {spanState === 'running' ? 'Resolving…' : 'router.resolveAsync(ctx)'}
          </button>
          {spanState === 'done' && (
            <button onClick={resetSim} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              Reset
            </button>
          )}
        </div>
        <div className="bg-gray-950 rounded-md p-4 min-h-24 space-y-2">
          {spans.length === 0 && spanState === 'idle' && (
            <p className="text-xs text-gray-500 font-mono">Waiting — click button to emit spans</p>
          )}
          {spans.map((span, i) => (
            <div key={i} className="text-xs font-mono">
              <div className="flex items-center gap-3">
                <span className="text-violet-400">▶ {span.name}</span>
                <span className="text-gray-500">{span.durationMs}ms</span>
                <span className="text-emerald-400">OK</span>
              </div>
              <div className="ml-4 text-gray-500 leading-relaxed">
                {Object.entries(span.attributes).map(([k, v]) => (
                  <div key={k}><span className="text-sky-400">{k}</span> = <span className="text-amber-300">{String(v)}</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Span reference */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Span schema</div>
        </div>
        {SPAN_TABLE.map(({ name, desc }) => (
          <div key={name} className="px-4 py-2.5 flex items-start gap-4">
            <code className="text-xs font-mono text-violet-700 shrink-0 mt-0.5">{name}</code>
            <span className="text-xs text-gray-500">{desc}</span>
          </div>
        ))}
      </div>

      {/* Span attributes */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Span attributes (all spans)</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {ATTRS.map(({ attr, example }) => (
            <div key={attr} className="flex gap-2">
              <code className="text-sky-700 shrink-0">{attr}</code>
              <span className="text-gray-400">{example}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Backend compat */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Backend compatibility</div>
        <div className="flex gap-2 flex-wrap mb-3">
          {BACKENDS.map((b) => (
            <button
              key={b.id}
              onClick={() => setActiveBackend(b.id)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                activeBackend === b.id
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{activeBackendInfo.note}</p>
      </div>

      {/* Code snippet */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Integration</div>
        <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed"><code>{snippet}</code></pre>
      </div>
    </div>
  );
}
