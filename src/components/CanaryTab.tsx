'use client';

import { useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CanaryRule {
  id: string;
  name: string;
  stableRef: string;
  canaryRef: string;
  canaryWeight: number; // 0–100
  provider: string;
  action: string;
  enabled: boolean;
}

interface SimulationResult {
  resolved: 'stable' | 'canary';
  credentialRef: string;
  count: number;
  timestamp: string;
}

// ─── Default demo rules ───────────────────────────────────────────────────────

const DEFAULT_RULES: CanaryRule[] = [
  {
    id: 'rule-openai-canary',
    name: 'OpenAI model upgrade (GPT-4o → GPT-4.1)',
    stableRef: 'openai-prod-slot',
    canaryRef: 'openai-canary-slot',
    canaryWeight: 10,
    provider: 'openai',
    action: 'complete',
    enabled: true,
  },
  {
    id: 'rule-anthropic-canary',
    name: 'Anthropic Claude 4 rollout',
    stableRef: 'anthropic-prod-slot',
    canaryRef: 'anthropic-claude4-slot',
    canaryWeight: 25,
    provider: 'anthropic',
    action: 'complete',
    enabled: false,
  },
  {
    id: 'rule-db-canary',
    name: 'Database credential rotation canary',
    stableRef: 'db-prod-slot',
    canaryRef: 'db-new-slot',
    canaryWeight: 5,
    provider: 'local',
    action: 'read',
    enabled: true,
  },
];

// ─── Weight slider ────────────────────────────────────────────────────────────

function WeightSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const stableWidth = 100 - value;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Stable {stableWidth}%</span>
        <span>Canary {value}%</span>
      </div>
      <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-gray-700 rounded-l-full transition-all"
          style={{ width: `${stableWidth}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-brand-500 rounded-r-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 opacity-0 absolute"
        style={{ marginTop: '-12px', cursor: 'pointer' }}
      />
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gray-900"
      />
    </div>
  );
}

// ─── Simulation bar ───────────────────────────────────────────────────────────

function SimulationBar({ results, total }: { results: SimulationResult[]; total: number }) {
  const canaryCount = results.filter((r) => r.resolved === 'canary').length;
  const stableCount = total - canaryCount;
  const canaryPct = total > 0 ? Math.round((canaryCount / total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Stable <strong className="text-gray-800">{stableCount}</strong> requests</span>
        <span className="text-brand-600">Canary <strong>{canaryCount}</strong> requests ({canaryPct}%)</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex">
        <div className="bg-gray-700 h-full transition-all" style={{ width: `${100 - canaryPct}%` }} />
        <div className="bg-brand-500 h-full transition-all" style={{ width: `${canaryPct}%` }} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CanaryTab() {
  const [rules, setRules] = useState<CanaryRule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState(DEFAULT_RULES[0].id);
  const [simCount, setSimCount] = useState(100);
  const [simResults, setSimResults] = useState<SimulationResult[]>([]);
  const [simRunning, setSimRunning] = useState(false);

  const selectedRule = rules.find((r) => r.id === selectedRuleId)!;

  // ── Update a rule field ───────────────────────────────────────────────────
  function updateRule<K extends keyof CanaryRule>(id: string, field: K, value: CanaryRule[K]) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setSimResults([]);
  }

  // ── Simulate traffic ───────────────────────────────────────────────────────
  const runSimulation = useCallback(() => {
    const rule = rules.find((r) => r.id === selectedRuleId);
    if (!rule) return;
    setSimRunning(true);
    setSimResults([]);

    const results: SimulationResult[] = [];
    let i = 0;
    const interval = setInterval(() => {
      if (i >= simCount) {
        clearInterval(interval);
        setSimRunning(false);
        return;
      }
      const isCanary = Math.random() * 100 < rule.canaryWeight;
      results.push({
        resolved: isCanary ? 'canary' : 'stable',
        credentialRef: isCanary ? rule.canaryRef : rule.stableRef,
        count: i + 1,
        timestamp: new Date().toISOString(),
      });
      setSimResults([...results]);
      i++;
    }, 20);
  }, [rules, selectedRuleId, simCount]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold mb-1">Canary credential routing</h2>
        <p className="text-sm text-gray-500">
          Route a percentage of agent requests to a canary credential — safely validate a new API key,
          model version, or rotated secret before full rollout. Zero downtime, zero code changes.
        </p>
      </div>

      {/* Rule list */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Canary rules</p>
        {rules.map((rule) => (
          <div
            key={rule.id}
            onClick={() => { setSelectedRuleId(rule.id); setSimResults([]); }}
            className={`border rounded-lg p-3 cursor-pointer transition-colors ${
              selectedRuleId === rule.id
                ? 'border-gray-900 bg-gray-50'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{rule.name}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {rule.enabled ? 'Active' : 'Inactive'}
                </span>
                <span className="text-xs text-gray-400">{rule.provider}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
              <div className="bg-gray-700 h-full" style={{ width: `${100 - rule.canaryWeight}%` }} />
              <div className="bg-brand-500 h-full" style={{ width: `${rule.canaryWeight}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>Stable {100 - rule.canaryWeight}%</span>
              <span>Canary {rule.canaryWeight}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Rule editor */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Edit rule</p>
          <button
            onClick={() => updateRule(selectedRule.id, 'enabled', !selectedRule.enabled)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              selectedRule.enabled
                ? 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                : 'border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {selectedRule.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {([
            { label: 'Stable credential ref', field: 'stableRef' as const },
            { label: 'Canary credential ref', field: 'canaryRef' as const },
            { label: 'Provider', field: 'provider' as const },
            { label: 'Action', field: 'action' as const },
          ] as { label: string; field: keyof CanaryRule }[]).map(({ label, field }) => (
            <div key={field}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                value={String(selectedRule[field])}
                onChange={(e) => updateRule(selectedRule.id, field, e.target.value as CanaryRule[typeof field])}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">Canary weight</label>
          <WeightSlider
            value={selectedRule.canaryWeight}
            onChange={(v) => updateRule(selectedRule.id, 'canaryWeight', v)}
          />
        </div>

        {/* Routing rule code */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Routing rule (copy to your config)</p>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto text-gray-700">{`const rule: RoutingRule = {
  id: '${selectedRule.id}',
  credentialRef: '${selectedRule.stableRef}',
  canaryRef: '${selectedRule.canaryRef}',
  canaryWeight: ${selectedRule.canaryWeight},
  matchProvider: '${selectedRule.provider}',
  matchAction: '${selectedRule.action}',
  priority: 10,
};`}</pre>
        </div>
      </div>

      {/* Simulation */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Traffic simulation</p>
        <p className="text-sm text-gray-500">
          Simulate N resolve() calls against the selected rule to verify the canary weight distribution.
        </p>
        <div className="flex items-center gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Requests</label>
            <select
              value={simCount}
              onChange={(e) => { setSimCount(Number(e.target.value)); setSimResults([]); }}
              className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none"
            >
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button
            onClick={runSimulation}
            disabled={simRunning}
            className="mt-4 px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {simRunning ? `Running… (${simResults.length}/${simCount})` : 'Run simulation'}
          </button>
        </div>

        {simResults.length > 0 && (
          <SimulationBar results={simResults} total={simResults.length} />
        )}

        {simResults.length === simCount && simCount > 0 && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>Simulation complete. Expected canary rate: <strong>{selectedRule.canaryWeight}%</strong>.</p>
            <p>Actual canary rate: <strong>{
              Math.round((simResults.filter((r) => r.resolved === 'canary').length / simResults.length) * 100)
            }%</strong> ({simResults.filter((r) => r.resolved === 'canary').length} of {simResults.length} requests).</p>
          </div>
        )}
      </div>

      {/* Explainer */}
      <div className="border border-gray-100 rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Use cases</p>
        <ul className="space-y-1.5 text-sm text-gray-600">
          {[
            'Safe credential rotation — route 5% of traffic to the new key, watch audit logs, then promote to 100%.',
            'Model upgrade validation — canary a new provider API key before deprecating the old one.',
            'Cost control — split traffic between a premium and a rate-limited budget credential.',
            'A/B testing — route different users to different model configurations with full audit trails.',
          ].map((use, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-gray-400 mt-0.5">→</span>
              <span>{use}</span>
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}
