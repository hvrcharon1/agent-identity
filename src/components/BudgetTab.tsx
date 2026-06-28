'use client';

import { useState, useEffect, useCallback } from 'react';

interface BudgetPolicy {
  maxResolutionsPerHour: number;
  maxConcurrentSessions: number;
  softThresholdPercent: number;
  resetSchedule: string;
}

interface CredentialBudgetState {
  id: string;
  name: string;
  provider: string;
  policy: BudgetPolicy;
  hourlyCount: number;
  concurrentSessions: number;
  dailySpend: number;
}

const SEED_CREDENTIALS: CredentialBudgetState[] = [
  {
    id: 'cred-openai-prod', name: 'OpenAI production', provider: 'openai',
    policy: { maxResolutionsPerHour: 1000, maxConcurrentSessions: 50, softThresholdPercent: 80, resetSchedule: '0 0 * * *' },
    hourlyCount: 812, concurrentSessions: 23, dailySpend: 142.50,
  },
  {
    id: 'cred-anthropic-prod', name: 'Anthropic production', provider: 'anthropic',
    policy: { maxResolutionsPerHour: 500, maxConcurrentSessions: 25, softThresholdPercent: 80, resetSchedule: '0 0 * * *' },
    hourlyCount: 210, concurrentSessions: 8, dailySpend: 67.30,
  },
  {
    id: 'cred-gemini-shared', name: 'Gemini shared', provider: 'gemini',
    policy: { maxResolutionsPerHour: 2000, maxConcurrentSessions: 100, softThresholdPercent: 75, resetSchedule: '0 0 * * *' },
    hourlyCount: 1950, concurrentSessions: 88, dailySpend: 31.10,
  },
];

function UsageBar({ value, max, soft }: { value: number; max: number; soft: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const exceeded = pct >= 100;
  const warned   = pct >= soft;
  const barColor = exceeded ? 'bg-red-500' : warned ? 'bg-amber-400' : 'bg-green-500';
  return (
    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className="absolute top-0 bottom-0 w-px bg-gray-300 z-10" style={{ left: `${soft}%` }} />
      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BudgetTab() {
  const [credentials, setCredentials] = useState<CredentialBudgetState[]>(SEED_CREDENTIALS);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [simCount, setSimCount] = useState(50);
  const [resetting, setResetting] = useState<string | null>(null);

  const fetchBudgetData = useCallback(async () => {
    try {
      const res = await fetch('/api/budget');
      if (!res.ok) return;
      const data = await res.json();
      if (data.credentials && data.credentials.length > 0) {
        setCredentials(data.credentials.map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name ?? c.id,
          provider: c.provider ?? 'unknown',
          policy: c.policy ?? { maxResolutionsPerHour: 1000, maxConcurrentSessions: 50, softThresholdPercent: 80, resetSchedule: '0 0 * * *' },
          hourlyCount: c.hourlyCount ?? 0,
          concurrentSessions: c.concurrentSessions ?? 0,
          dailySpend: c.dailySpend ?? 0,
        })));
      }
    } catch {
      // Keep seed data on fetch failure
    }
  }, []);

  useEffect(() => {
    fetchBudgetData();
    const interval = setInterval(fetchBudgetData, 10000);
    return () => clearInterval(interval);
  }, [fetchBudgetData]);

  function simulateResolutions(credId: string) {
    setSimulating(credId);
    setCredentials((prev) =>
      prev.map((c) => {
        if (c.id !== credId) return c;
        return { ...c, hourlyCount: Math.min(c.hourlyCount + simCount, c.policy.maxResolutionsPerHour) };
      })
    );
    setTimeout(() => setSimulating(null), 600);
  }

  async function resetHourly(credId: string) {
    setResetting(credId);
    try {
      const res = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: credId, counter: 'hourly' }),
      });
      if (res.ok) {
        setCredentials((prev) => prev.map((c) => (c.id === credId ? { ...c, hourlyCount: 0 } : c)));
      } else {
        setCredentials((prev) => prev.map((c) => (c.id === credId ? { ...c, hourlyCount: 0 } : c)));
      }
    } catch {
      setCredentials((prev) => prev.map((c) => (c.id === credId ? { ...c, hourlyCount: 0 } : c)));
    } finally {
      setResetting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Credential budget management</h2>
        <p className="text-sm text-gray-500 mt-1">
          Enforce per-credential resolution limits at the routing layer — before any call reaches the provider.
          Hard limits block resolve(); soft threshold emits a <span className="font-mono text-xs bg-gray-100 px-1 rounded">credential.budget_warning</span> audit event.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-xs font-medium text-blue-700 mb-2">Simulator — add N resolutions</p>
        <div className="flex items-center gap-3">
          <input type="range" min={1} max={200} value={simCount} onChange={(e) => setSimCount(Number(e.target.value))} className="flex-1 accent-blue-600" />
          <span className="text-sm font-medium text-blue-700 w-12 text-right">{simCount}</span>
        </div>
        <p className="text-xs text-blue-500 mt-1">Click Simulate on any credential to add {simCount} resolutions to its hourly count.</p>
      </div>

      <div className="space-y-4">
        {credentials.map((cred) => {
          const hourlyPct    = (cred.hourlyCount / cred.policy.maxResolutionsPerHour) * 100;
          const sessionPct   = (cred.concurrentSessions / cred.policy.maxConcurrentSessions) * 100;
          const hourlyExceeded  = hourlyPct >= 100;
          const hourlyWarned    = hourlyPct >= cred.policy.softThresholdPercent;
          const sessionExceeded = sessionPct >= 100;

          return (
            <div key={cred.id} className="border border-gray-200 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{cred.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{cred.id}</p>
                </div>
                <div className="flex gap-2">
                  {hourlyExceeded  && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Limit exceeded</span>}
                  {!hourlyExceeded && hourlyWarned && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Warning threshold</span>}
                  {sessionExceeded && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Sessions exceeded</span>}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Hourly resolutions</span>
                    <span className={hourlyExceeded ? 'text-red-600 font-medium' : hourlyWarned ? 'text-amber-600 font-medium' : ''}>
                      {cred.hourlyCount.toLocaleString()} / {cred.policy.maxResolutionsPerHour.toLocaleString()}
                    </span>
                  </div>
                  <UsageBar value={cred.hourlyCount} max={cred.policy.maxResolutionsPerHour} soft={cred.policy.softThresholdPercent} />
                  <p className="text-xs text-gray-400 mt-0.5">
                    Soft threshold at {cred.policy.softThresholdPercent}% · {Math.floor((cred.policy.maxResolutionsPerHour * cred.policy.softThresholdPercent) / 100).toLocaleString()} resolutions
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Concurrent sessions</span>
                    <span className={sessionExceeded ? 'text-red-600 font-medium' : ''}>{cred.concurrentSessions} / {cred.policy.maxConcurrentSessions}</span>
                  </div>
                  <UsageBar value={cred.concurrentSessions} max={cred.policy.maxConcurrentSessions} soft={cred.policy.softThresholdPercent} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-gray-400">Reset schedule</p>
                  <p className="font-mono text-gray-700">{cred.policy.resetSchedule}</p>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-gray-400">Daily spend (est.)</p>
                  <p className="font-mono text-gray-700">${cred.dailySpend.toFixed(2)}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => simulateResolutions(cred.id)}
                  disabled={simulating === cred.id || hourlyExceeded}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    hourlyExceeded ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                    : simulating === cred.id ? 'border-gray-200 text-gray-400'
                    : 'border-blue-300 text-blue-600 hover:bg-blue-50'
                  }`}
                >
                  {simulating === cred.id ? 'Simulating...' : `Simulate +${simCount}`}
                </button>
                <button
                  onClick={() => resetHourly(cred.id)}
                  disabled={resetting === cred.id}
                  className="px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-500 hover:border-gray-400 transition-colors disabled:opacity-50"
                >
                  {resetting === cred.id ? 'Resetting...' : 'Reset hourly'}
                </button>
              </div>

              {hourlyExceeded && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-xs text-red-700 font-medium">Hard limit reached</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    resolve() returns <span className="font-mono">{'{'}{ 'status: 429, retryAfter: "..."' }{'}'}</span>.
                    New resolutions are blocked until the hourly window resets or an override is applied.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-700 mb-2">API endpoints</p>
        <div className="space-y-1">
          {[
            { method: 'GET',  path: '/api/budget',                        desc: 'Current utilisation for all credentials' },
            { method: 'POST', path: '/api/budget',                        desc: 'Reset hourly or daily counter for a credential' },
            { method: 'GET',  path: '/api/budget/:credentialId/history',  desc: 'Time-series hourly and daily data' },
          ].map((e) => (
            <div key={e.path + e.method} className="flex items-start gap-2">
              <span className="text-xs font-mono font-bold text-blue-600">{e.method}</span>
              <span className="text-xs font-mono text-gray-600">{e.path}</span>
              <span className="text-xs text-gray-400">{e.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
