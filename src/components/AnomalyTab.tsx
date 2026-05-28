'use client';

import { useState, useCallback } from 'react';

// ─── Types (mirrored from @datacules/agent-identity-anomaly) ─────────────────

type AnomalySignal =
  | 'rate_spike'
  | 'new_credential_type'
  | 'new_action_type'
  | 'new_resource_kind'
  | 'off_hours'
  | 'new_provider';

type AnomalySeverity = 'low' | 'medium' | 'high';
type AnomalyAction = 'warn' | 'throttle' | 'block';

interface AnomalyEvent {
  signal: AnomalySignal;
  severity: AnomalySeverity;
  baselineValue: unknown;
  observedValue: unknown;
  userId: string;
  credentialId?: string;
  timestamp: string;
}

interface AnomalyPolicy {
  lowAction: AnomalyAction;
  mediumAction: AnomalyAction;
  highAction: AnomalyAction;
  baselineSamples: number;
  rateSpikeThreshold: number;
}

interface AgentBaseline {
  userId: string;
  sampleCount: number;
  knownActions: string[];
  knownResourceKinds: string[];
  knownProviders: string[];
  ewmaRatePerHour: number;
  status: 'collecting' | 'active';
}

// ─── Seed demo data ──────────────────────────────────────────────────────────

const DEMO_BASELINES: AgentBaseline[] = [
  {
    userId: 'user-alice',
    sampleCount: 47,
    knownActions: ['read', 'write'],
    knownResourceKinds: ['personal'],
    knownProviders: ['openai'],
    ewmaRatePerHour: 12,
    status: 'active',
  },
  {
    userId: 'user-bob',
    sampleCount: 8,
    knownActions: ['read'],
    knownResourceKinds: ['shared'],
    knownProviders: ['anthropic'],
    ewmaRatePerHour: 0,
    status: 'collecting',
  },
  {
    userId: 'svc-migration-bot',
    sampleCount: 312,
    knownActions: ['read', 'write', 'delete'],
    knownResourceKinds: ['shared', 'personal'],
    knownProviders: ['anthropic', 'openai'],
    ewmaRatePerHour: 84,
    status: 'active',
  },
];

const DEMO_EVENTS: AnomalyEvent[] = [
  {
    signal: 'rate_spike',
    severity: 'high',
    baselineValue: 12,
    observedValue: 47,
    userId: 'user-alice',
    credentialId: 'cred-openai-alice',
    timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  },
  {
    signal: 'new_provider',
    severity: 'low',
    baselineValue: ['openai'],
    observedValue: 'anthropic',
    userId: 'user-alice',
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    signal: 'new_action_type',
    severity: 'medium',
    baselineValue: ['read'],
    observedValue: 'delete',
    userId: 'svc-migration-bot',
    credentialId: 'cred-svc-bot',
    timestamp: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<AnomalySignal, string> = {
  rate_spike: 'Rate spike',
  new_credential_type: 'New credential type',
  new_action_type: 'New action type',
  new_resource_kind: 'New resource kind',
  off_hours: 'Off-hours access',
  new_provider: 'New provider',
};

const SEVERITY_CLASSES: Record<AnomalySeverity, string> = {
  low: 'bg-blue-50 text-blue-700 border-blue-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  high: 'bg-red-50 text-red-700 border-red-100',
};

const ACTION_CLASSES: Record<AnomalyAction, string> = {
  warn: 'border-gray-200 text-gray-500 hover:border-gray-400',
  throttle: 'border-amber-300 text-amber-700 bg-amber-50 hover:border-amber-400',
  block: 'border-red-300 text-red-700 bg-red-50 hover:border-red-400',
};

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Simulate resolve ─────────────────────────────────────────────────────────

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'mistral', 'local'];
const ACTIONS = ['read', 'write', 'delete', 'summarise', 'embed'];
const RESOURCE_KINDS = ['personal', 'shared'];

function simulateObserve(
  baseline: AgentBaseline,
  policy: AnomalyPolicy
): AnomalyEvent[] {
  if (baseline.sampleCount < policy.baselineSamples) return [];
  const events: AnomalyEvent[] = [];
  const ts = new Date().toISOString();

  // Random provider that may or may not be known
  const provider = PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)];
  if (!baseline.knownProviders.includes(provider)) {
    events.push({
      signal: 'new_provider',
      severity: 'low',
      baselineValue: [...baseline.knownProviders],
      observedValue: provider,
      userId: baseline.userId,
      timestamp: ts,
    });
  }

  // Random action that may or may not be known
  const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  if (!baseline.knownActions.includes(action)) {
    events.push({
      signal: 'new_action_type',
      severity: 'medium',
      baselineValue: [...baseline.knownActions],
      observedValue: action,
      userId: baseline.userId,
      timestamp: ts,
    });
  }

  // Occasional rate spike
  if (Math.random() < 0.15 && baseline.ewmaRatePerHour > 0) {
    const spike = Math.round(baseline.ewmaRatePerHour * (policy.rateSpikeThreshold + Math.random()));
    events.push({
      signal: 'rate_spike',
      severity: 'high',
      baselineValue: baseline.ewmaRatePerHour,
      observedValue: spike,
      userId: baseline.userId,
      timestamp: ts,
    });
  }

  return events;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AnomalySeverity }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${SEVERITY_CLASSES[severity]}`}>
      {severity}
    </span>
  );
}

function BaselineCard({
  baseline,
  selected,
  onSelect,
  onReset,
  baselineSamples,
}: {
  baseline: AgentBaseline;
  selected: boolean;
  onSelect: () => void;
  onReset: () => void;
  baselineSamples: number;
}) {
  const pct = Math.min(100, Math.round((baseline.sampleCount / baselineSamples) * 100));
  return (
    <div
      onClick={onSelect}
      className={`border rounded-lg p-3 cursor-pointer transition-colors ${
        selected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono font-medium">{baseline.userId}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            baseline.status === 'active'
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {baseline.status === 'active' ? 'Scoring' : 'Collecting'}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            Reset
          </button>
        </div>
      </div>
      {baseline.status === 'collecting' ? (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Baseline samples</span>
            <span>{baseline.sampleCount} / {baselineSamples}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{baseline.sampleCount} samples</span>
          <span>{Math.round(baseline.ewmaRatePerHour)} req/hr baseline</span>
          <span>{baseline.knownProviders.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: AnomalyEvent }) {
  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={event.severity} />
          <span className="text-sm font-medium">{SIGNAL_LABELS[event.signal]}</span>
        </div>
        <span className="text-xs text-gray-400">{relativeTime(event.timestamp)}</span>
      </div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span>user: <span className="font-mono text-gray-700">{event.userId}</span></span>
        {event.credentialId && (
          <span>cred: <span className="font-mono text-gray-700">{event.credentialId}</span></span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-400 mb-0.5">Baseline</p>
          <p className="text-xs font-mono text-gray-700 break-all">
            {Array.isArray(event.baselineValue)
              ? (event.baselineValue as unknown[]).join(', ') || '—'
              : String(event.baselineValue)}
          </p>
        </div>
        <div className="bg-amber-50 rounded p-2">
          <p className="text-xs text-amber-600 mb-0.5">Observed</p>
          <p className="text-xs font-mono text-amber-800 break-all">
            {Array.isArray(event.observedValue)
              ? (event.observedValue as unknown[]).join(', ')
              : String(event.observedValue)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnomalyTab() {
  const [policy, setPolicy] = useState<AnomalyPolicy>({
    lowAction: 'warn',
    mediumAction: 'warn',
    highAction: 'warn',
    baselineSamples: 20,
    rateSpikeThreshold: 3.0,
  });
  const [baselines, setBaselines] = useState<AgentBaseline[]>(DEMO_BASELINES);
  const [selectedUserId, setSelectedUserId] = useState(DEMO_BASELINES[0].userId);
  const [events, setEvents] = useState<AnomalyEvent[]>(DEMO_EVENTS);
  const [simulating, setSimulating] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<AnomalySeverity | 'all'>('all');

  const selectedBaseline = baselines.find((b) => b.userId === selectedUserId)!;

  // ── Reset a baseline ───────────────────────────────────────────────────────
  const resetBaseline = useCallback((userId: string) => {
    setBaselines((prev) =>
      prev.map((b) =>
        b.userId === userId
          ? { ...b, sampleCount: 0, knownActions: [], knownResourceKinds: [], knownProviders: [], ewmaRatePerHour: 0, status: 'collecting' as const }
          : b
      )
    );
    setEvents((prev) => prev.filter((e) => e.userId !== userId));
  }, []);

  // ── Simulate a resolve() call ──────────────────────────────────────────────
  const runObserve = useCallback(() => {
    setSimulating(true);
    setTimeout(() => {
      const newEvents = simulateObserve(selectedBaseline, policy);
      // Update baseline sampleCount + learned values
      setBaselines((prev) =>
        prev.map((b) => {
          if (b.userId !== selectedBaseline.userId) return b;
          const provider = PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)];
          const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
          const resourceKind = RESOURCE_KINDS[Math.floor(Math.random() * RESOURCE_KINDS.length)];
          const newCount = b.sampleCount + 1;
          const isActive = newCount >= policy.baselineSamples;
          return {
            ...b,
            sampleCount: newCount,
            status: isActive ? 'active' : 'collecting',
            knownProviders: b.knownProviders.includes(provider) ? b.knownProviders : [...b.knownProviders, provider],
            knownActions: b.knownActions.includes(action) ? b.knownActions : [...b.knownActions, action],
            knownResourceKinds: b.knownResourceKinds.includes(resourceKind) ? b.knownResourceKinds : [...b.knownResourceKinds, resourceKind],
            ewmaRatePerHour: b.ewmaRatePerHour === 0 ? 10 : 0.1 * 10 + 0.9 * b.ewmaRatePerHour,
          };
        })
      );
      if (newEvents.length > 0) {
        setEvents((prev) => [...newEvents, ...prev].slice(0, 50));
      }
      setSimulating(false);
    }, 300);
  }, [selectedBaseline, policy]);

  const filteredEvents = filterSeverity === 'all'
    ? events
    : events.filter((e) => e.severity === filterSeverity);

  const eventCounts = {
    high: events.filter((e) => e.severity === 'high').length,
    medium: events.filter((e) => e.severity === 'medium').length,
    low: events.filter((e) => e.severity === 'low').length,
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold mb-1">Anomaly detection</h2>
        <p className="text-sm text-gray-500">
          Builds a behavioral baseline per agent over the first N resolutions.
          Each new resolve is scored against the baseline — rate spikes, new
          providers, or new action types emit <code className="text-xs bg-gray-100 px-1 rounded">credential.anomaly</code> audit
          events and can warn, throttle, or block the request.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: 'High severity', count: eventCounts.high, cls: 'text-red-600' },
          { label: 'Medium severity', count: eventCounts.medium, cls: 'text-amber-600' },
          { label: 'Low severity', count: eventCounts.low, cls: 'text-blue-600' },
        ] as { label: string; count: number; cls: string }[]).map(({ label, count, cls }) => (
          <div key={label} className="border border-gray-100 rounded-lg p-3 text-center">
            <p className={`text-2xl font-semibold ${cls}`}>{count}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Agent baselines */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Agent baselines</p>
        {baselines.map((b) => (
          <BaselineCard
            key={b.userId}
            baseline={b}
            selected={selectedUserId === b.userId}
            onSelect={() => setSelectedUserId(b.userId)}
            onReset={() => resetBaseline(b.userId)}
            baselineSamples={policy.baselineSamples}
          />
        ))}
      </div>

      {/* Simulate observe() */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Simulate resolve()</p>
        <p className="text-sm text-gray-500">
          Trigger one <code className="text-xs bg-gray-100 px-1 rounded">detector.observe(ctx, router.resolveAsync)</code> call
          for <strong>{selectedUserId}</strong>. Anomaly events (if any) will appear in the feed below.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runObserve}
            disabled={simulating}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {simulating ? 'Observing…' : 'Run observe()'}
          </button>
          {selectedBaseline.status === 'collecting' && (
            <span className="text-xs text-amber-600">
              Still collecting baseline ({selectedBaseline.sampleCount} / {policy.baselineSamples} samples). Run more to unlock scoring.
            </span>
          )}
        </div>
      </div>

      {/* Policy config */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Detection policy</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { label: 'Low severity action', field: 'lowAction' as const },
            { label: 'Medium severity action', field: 'mediumAction' as const },
            { label: 'High severity action', field: 'highAction' as const },
          ] as { label: string; field: keyof AnomalyPolicy }[]).map(({ label, field }) => (
            <div key={field}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <select
                value={String(policy[field])}
                onChange={(e) => setPolicy((p) => ({ ...p, [field]: e.target.value as AnomalyAction }))}
                className={`w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900 ${
                  ACTION_CLASSES[policy[field] as AnomalyAction] ?? 'border-gray-200'
                }`}
              >
                <option value="warn">warn</option>
                <option value="throttle">throttle</option>
                <option value="block">block</option>
              </select>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Baseline samples (before scoring)</label>
            <input
              type="number"
              min={5}
              max={500}
              value={policy.baselineSamples}
              onChange={(e) => setPolicy((p) => ({ ...p, baselineSamples: Number(e.target.value) }))}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Rate spike threshold (×EWMA)</label>
            <input
              type="number"
              min={1.5}
              max={10}
              step={0.5}
              value={policy.rateSpikeThreshold}
              onChange={(e) => setPolicy((p) => ({ ...p, rateSpikeThreshold: Number(e.target.value) }))}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
        </div>

        {/* Config code snippet */}
        <div>
          <p className="text-xs text-gray-500 mb-1">AnomalyDetector config (copy to your app)</p>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto text-gray-700">{`import { AnomalyDetector } from '@datacules/agent-identity-anomaly';

const detector = new AnomalyDetector({
  logger,
  policy: {
    lowAction: '${policy.lowAction}',
    mediumAction: '${policy.mediumAction}',
    highAction: '${policy.highAction}',
    baselineSamples: ${policy.baselineSamples},
    rateSpikeThreshold: ${policy.rateSpikeThreshold},
  },
  onAnomaly: (event) => console.warn('[anomaly]', event.signal, event.userId),
});

// Wrap every resolve call:
const resolved = await detector.observe(ctx, () => router.resolveAsync(ctx));`}</pre>
        </div>
      </div>

      {/* Event feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">
            Anomaly events ({filteredEvents.length})
          </p>
          <div className="flex gap-1">
            {(['all', 'high', 'medium', 'low'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSeverity(s)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  filterSeverity === s
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
            No anomaly events. Run <code className="text-xs bg-gray-100 px-1 rounded">observe()</code> above to generate some.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredEvents.map((event, i) => (
              <EventRow key={`${event.userId}-${event.signal}-${i}`} event={event} />
            ))}
          </div>
        )}
      </div>

      {/* Explainer */}
      <div className="border border-gray-100 rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">How it works</p>
        <ul className="space-y-1.5 text-sm text-gray-600">
          {[
            'Each agent builds its own behavioral baseline over the first N resolve() calls (default: 20).',
            'After the baseline window, every resolve is scored against known actions, providers, resource kinds, and EWMA call rate.',
            'Deviations emit credential.anomaly audit events — caught by any AuditLogger sink (Datadog, Splunk, Webhook).',
            'Policy actions per severity: warn (log only), throttle (return null after delay), block (return null immediately).',
            'Zero routing config changes needed — wrap the router with AnomalyDetector.observe() in one line.',
          ].map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-gray-400 mt-0.5">→</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}
