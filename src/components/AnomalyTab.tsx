'use client';

import { useState, useCallback } from 'react';

// ─── Types mirrored from @datacules/agent-identity-anomaly ──────────────────

type AnomalySignal =
  | 'rate_spike'
  | 'new_credential_type'
  | 'new_action_type'
  | 'new_resource_kind'
  | 'off_hours'
  | 'new_provider';

type AnomalySeverity = 'low' | 'medium' | 'high';
type AnomalyAction   = 'warn' | 'throttle' | 'block';

interface AnomalyEvent {
  id: string;
  signal: AnomalySignal;
  severity: AnomalySeverity;
  baselineValue: unknown;
  observedValue: unknown;
  userId: string;
  credentialId?: string;
  timestamp: string;
  action: AnomalyAction;
}

interface AgentBaseline {
  userId: string;
  sampleCount: number;
  knownActions: string[];
  knownResourceKinds: string[];
  knownProviders: string[];
  ewmaRatePerHour: number;
}

interface AnomalyPolicy {
  lowAction: AnomalyAction;
  mediumAction: AnomalyAction;
  highAction: AnomalyAction;
  baselineSamples: number;
  rateSpikeThreshold: number;
}

// ─── Seed data ───────────────────────────────────────────────────────────────

const SEED_BASELINES: AgentBaseline[] = [
  {
    userId: 'user-alice',
    sampleCount: 42,
    knownActions: ['read', 'summarise'],
    knownResourceKinds: ['document', 'email'],
    knownProviders: ['openai'],
    ewmaRatePerHour: 12.4,
  },
  {
    userId: 'user-bob',
    sampleCount: 28,
    knownActions: ['read', 'write', 'classify'],
    knownResourceKinds: ['code', 'pr'],
    knownProviders: ['anthropic', 'openai'],
    ewmaRatePerHour: 5.8,
  },
  {
    userId: 'svc-etl-agent',
    sampleCount: 8, // still collecting baseline
    knownActions: ['transform'],
    knownResourceKinds: ['dataset'],
    knownProviders: ['gemini'],
    ewmaRatePerHour: 0,
  },
];

const SEED_EVENTS: AnomalyEvent[] = [
  {
    id: 'evt-1',
    signal: 'rate_spike',
    severity: 'high',
    baselineValue: 12.4,
    observedValue: 48,
    userId: 'user-alice',
    timestamp: new Date(Date.now() - 4 * 60000).toISOString(),
    action: 'warn',
  },
  {
    id: 'evt-2',
    signal: 'new_action_type',
    severity: 'medium',
    baselineValue: ['read', 'summarise'],
    observedValue: 'delete',
    userId: 'user-alice',
    credentialId: 'cred-openai-prod',
    timestamp: new Date(Date.now() - 11 * 60000).toISOString(),
    action: 'warn',
  },
  {
    id: 'evt-3',
    signal: 'new_provider',
    severity: 'low',
    baselineValue: ['anthropic', 'openai'],
    observedValue: 'mistral',
    userId: 'user-bob',
    timestamp: new Date(Date.now() - 33 * 60000).toISOString(),
    action: 'warn',
  },
];

const SIGNAL_LABELS: Record<AnomalySignal, string> = {
  rate_spike:          'Rate spike',
  new_credential_type: 'New credential type',
  new_action_type:     'New action type',
  new_resource_kind:   'New resource kind',
  off_hours:           'Off-hours access',
  new_provider:        'New provider',
};

const SEVERITY_STYLES: Record<AnomalySeverity, string> = {
  low:    'bg-blue-100 text-blue-700',
  medium: 'bg-amber-100 text-amber-700',
  high:   'bg-red-100 text-red-700',
};

const ACTION_STYLES: Record<AnomalyAction, string> = {
  warn:     'bg-gray-100 text-gray-600',
  throttle: 'bg-amber-100 text-amber-700',
  block:    'bg-red-100 text-red-700',
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (typeof v === 'number') return v.toFixed(1);
  return String(v);
}

// ─── Simulator helpers ───────────────────────────────────────────────────────

const ACTIONS   = ['read', 'write', 'delete', 'summarise', 'classify', 'transform', 'export'];
const RESOURCES = ['document', 'email', 'code', 'pr', 'dataset', 'report', 'calendar'];
const PROVIDERS = ['openai', 'anthropic', 'gemini', 'mistral', 'local'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AnomalyTab() {
  const [baselines, setBaselines] = useState<AgentBaseline[]>(SEED_BASELINES);
  const [events,    setEvents]    = useState<AnomalyEvent[]>(SEED_EVENTS);
  const [policy,    setPolicy]    = useState<AnomalyPolicy>({
    lowAction:           'warn',
    mediumAction:        'warn',
    highAction:          'warn',
    baselineSamples:     20,
    rateSpikeThreshold:  3.0,
  });
  const [simUserId,  setSimUserId]  = useState<string>(SEED_BASELINES[0].userId);
  const [simAction,  setSimAction]  = useState<string>('delete');
  const [firing,     setFiring]     = useState(false);

  const totalEvents   = events.length;
  const highEvents    = events.filter((e) => e.severity === 'high').length;
  const blockedCalls  = events.filter((e) => e.action === 'block').length;
  const agentsMonitored = baselines.length;

  const fireSimulation = useCallback(() => {
    setFiring(true);

    const baseline = baselines.find((b) => b.userId === simUserId);
    if (!baseline) { setFiring(false); return; }

    const newEvents: AnomalyEvent[] = [];
    const ts = new Date().toISOString();
    const isBaselined = baseline.sampleCount >= policy.baselineSamples;

    if (isBaselined) {
      // Check for new action type
      if (!baseline.knownActions.includes(simAction)) {
        const action = policy.mediumAction;
        newEvents.push({
          id: `evt-${Date.now()}-a`,
          signal: 'new_action_type',
          severity: 'medium',
          baselineValue: [...baseline.knownActions],
          observedValue: simAction,
          userId: simUserId,
          timestamp: ts,
          action,
        });
      }

      // Random chance of rate spike
      if (Math.random() < 0.35 && baseline.ewmaRatePerHour > 0) {
        const spikeRate = baseline.ewmaRatePerHour * (policy.rateSpikeThreshold + 1);
        const action = policy.highAction;
        newEvents.push({
          id: `evt-${Date.now()}-r`,
          signal: 'rate_spike',
          severity: 'high',
          baselineValue: baseline.ewmaRatePerHour,
          observedValue: Math.round(spikeRate),
          userId: simUserId,
          timestamp: ts,
          action,
        });
      }

      // Occasionally pick new provider
      const rProvider = pickRandom(PROVIDERS);
      if (!baseline.knownProviders.includes(rProvider) && Math.random() < 0.4) {
        const action = policy.lowAction;
        newEvents.push({
          id: `evt-${Date.now()}-p`,
          signal: 'new_provider',
          severity: 'low',
          baselineValue: [...baseline.knownProviders],
          observedValue: rProvider,
          userId: simUserId,
          timestamp: ts,
          action,
        });
      }
    }

    // Update baseline regardless
    setBaselines((prev) =>
      prev.map((b) => {
        if (b.userId !== simUserId) return b;
        const newActions       = b.knownActions.includes(simAction) ? b.knownActions : [...b.knownActions, simAction];
        const newResourceKinds = [...new Set([...b.knownResourceKinds, pickRandom(RESOURCES)])];
        const newProviders     = [...new Set([...b.knownProviders, pickRandom(PROVIDERS)])];
        return {
          ...b,
          sampleCount:       b.sampleCount + 1,
          knownActions:      newActions,
          knownResourceKinds: newResourceKinds,
          knownProviders:    newProviders,
          ewmaRatePerHour:   b.ewmaRatePerHour === 0 ? 1 : 0.1 * 1 + 0.9 * b.ewmaRatePerHour,
        };
      })
    );

    if (newEvents.length > 0) {
      setEvents((prev) => [...newEvents, ...prev].slice(0, 50));
    }

    setTimeout(() => setFiring(false), 500);
  }, [baselines, simUserId, simAction, policy]);

  function resetBaseline(userId: string) {
    setBaselines((prev) =>
      prev.map((b) =>
        b.userId === userId
          ? { ...b, sampleCount: 0, knownActions: [], knownResourceKinds: [], knownProviders: [], ewmaRatePerHour: 0 }
          : b
      )
    );
    setEvents((prev) => prev.filter((e) => e.userId !== userId));
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-gray-900">Anomaly detection</h2>
        <p className="text-sm text-gray-500 mt-1">
          Each agent builds a rolling behavioral baseline over its first{' '}
          <span className="font-mono text-xs bg-gray-100 px-1 rounded">{policy.baselineSamples}</span> resolutions.
          Deviations emit <span className="font-mono text-xs bg-gray-100 px-1 rounded">credential.anomaly</span> audit events
          and can <strong>warn</strong>, <strong>throttle</strong>, or <strong>block</strong> the resolution.
        </p>
      </div>

      {/* Metrics strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total events',      value: totalEvents,     color: 'text-gray-900' },
          { label: 'High severity',      value: highEvents,      color: highEvents > 0 ? 'text-red-600' : 'text-gray-900' },
          { label: 'Agents monitored',   value: agentsMonitored, color: 'text-gray-900' },
          { label: 'Blocked calls',      value: blockedCalls,    color: blockedCalls > 0 ? 'text-red-600' : 'text-gray-900' },
        ].map(({ label, value, color }) => (
          <div key={label} className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-400">{label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Policy config */}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-700 mb-3">Detection policy</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {([
            { key: 'lowAction',    label: 'Low severity action'    },
            { key: 'mediumAction', label: 'Medium severity action'  },
            { key: 'highAction',   label: 'High severity action'    },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{label}</span>
              <select
                value={policy[key]}
                onChange={(e) => setPolicy((p) => ({ ...p, [key]: e.target.value as AnomalyAction }))}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
              >
                <option value="warn">warn</option>
                <option value="throttle">throttle</option>
                <option value="block">block</option>
              </select>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Baseline samples</span>
            <input
              type="number" min={5} max={100}
              value={policy.baselineSamples}
              onChange={(e) => setPolicy((p) => ({ ...p, baselineSamples: Number(e.target.value) }))}
              className="text-xs border border-gray-200 rounded px-2 py-1 w-16 text-right text-gray-700"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Rate spike threshold (×)</span>
            <input
              type="number" min={1.5} max={10} step={0.5}
              value={policy.rateSpikeThreshold}
              onChange={(e) => setPolicy((p) => ({ ...p, rateSpikeThreshold: Number(e.target.value) }))}
              className="text-xs border border-gray-200 rounded px-2 py-1 w-16 text-right text-gray-700"
            />
          </div>
        </div>
      </div>

      {/* Simulator */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-xs font-medium text-amber-700 mb-3">Simulator — fire a synthetic observe() call</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-amber-600 mb-1">Agent</label>
            <select
              value={simUserId}
              onChange={(e) => setSimUserId(e.target.value)}
              className="text-xs border border-amber-300 rounded px-2 py-1.5 bg-white text-gray-700"
            >
              {baselines.map((b) => (
                <option key={b.userId} value={b.userId}>{b.userId}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-amber-600 mb-1">Action</label>
            <select
              value={simAction}
              onChange={(e) => setSimAction(e.target.value)}
              className="text-xs border border-amber-300 rounded px-2 py-1.5 bg-white text-gray-700"
            >
              {ACTIONS.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </div>
          <button
            onClick={fireSimulation}
            disabled={firing}
            className={`px-4 py-1.5 text-xs rounded-md font-medium transition-colors ${
              firing
                ? 'bg-amber-300 text-white cursor-not-allowed'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {firing ? 'Firing…' : 'Fire observe()'}
          </button>
        </div>
        <p className="text-xs text-amber-600 mt-2">
          Agents with fewer than {policy.baselineSamples} samples are still collecting their baseline — no anomalies will fire.
        </p>
      </div>

      {/* Agent baselines */}
      <div>
        <p className="text-xs font-medium text-gray-700 mb-2">Agent baselines</p>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {baselines.map((b) => {
            const ready = b.sampleCount >= policy.baselineSamples;
            return (
              <div key={b.userId} className="p-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">{b.userId}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      ready ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {ready ? 'Scoring active' : `Collecting (${b.sampleCount}/${policy.baselineSamples})`}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-500">Actions:</span>{' '}
                      {b.knownActions.length ? b.knownActions.join(', ') : '—'}
                    </p>
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-500">Providers:</span>{' '}
                      {b.knownProviders.length ? b.knownProviders.join(', ') : '—'}
                    </p>
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-500">Resources:</span>{' '}
                      {b.knownResourceKinds.length ? b.knownResourceKinds.join(', ') : '—'}
                    </p>
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-500">EWMA rate/hr:</span>{' '}
                      {b.ewmaRatePerHour > 0 ? b.ewmaRatePerHour.toFixed(1) : '—'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => resetBaseline(b.userId)}
                  className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:border-gray-400 shrink-0 transition-colors"
                >
                  Reset
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event log */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-700">Recent anomaly events</p>
          {events.length > 0 && (
            <button
              onClick={() => setEvents([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {events.length === 0 ? (
          <div className="border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-400">No anomaly events yet.</p>
            <p className="text-xs text-gray-400 mt-1">Use the simulator above to trigger events.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {events.map((evt) => (
              <div key={evt.id} className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[evt.severity]}`}>
                    {evt.severity}
                  </span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ACTION_STYLES[evt.action]}`}>
                    {evt.action}
                  </span>
                  <span className="text-xs font-medium text-gray-900">{SIGNAL_LABELS[evt.signal]}</span>
                  <span className="text-xs text-gray-400 ml-auto">{relTime(evt.timestamp)}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-4 text-xs">
                  <p className="text-gray-400">
                    <span className="text-gray-500">Agent:</span> {evt.userId}
                  </p>
                  {evt.credentialId && (
                    <p className="text-gray-400 font-mono">{evt.credentialId}</p>
                  )}
                  <p className="text-gray-400 col-span-2">
                    <span className="text-gray-500">Baseline:</span>{' '}
                    <span className="font-mono">{formatValue(evt.baselineValue)}</span>
                    {' → '}
                    <span className="text-gray-500">Observed:</span>{' '}
                    <span className="font-mono">{formatValue(evt.observedValue)}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API reference */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-700 mb-2">API endpoints</p>
        <div className="space-y-1">
          {[
            { method: 'GET',  path: '/api/anomaly',       desc: 'Current detector state — baselines and recent events' },
            { method: 'POST', path: '/api/anomaly/reset', desc: 'Reset a specific agent baseline by userId' },
          ].map((e) => (
            <div key={e.path} className="flex items-start gap-2">
              <span className="text-xs font-mono font-bold text-blue-600">{e.method}</span>
              <span className="text-xs font-mono text-gray-600">{e.path}</span>
              <span className="text-xs text-gray-400">{e.desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-700 mb-1">Library usage</p>
          <pre className="text-xs bg-white border border-gray-100 rounded p-2 overflow-x-auto text-gray-600">{`import { AnomalyDetector } from '@datacules/agent-identity-anomaly';

const detector = new AnomalyDetector({
  logger,
  policy: { highAction: 'block', baselineSamples: 20 },
});

// Wrap every resolve call:
const resolved = await detector.observe(ctx, () =>
  router.resolveAsync(ctx)
);`}</pre>
        </div>
      </div>

    </div>
  );
}
