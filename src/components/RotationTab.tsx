'use client';

import { useState } from 'react';

interface RotationPolicy {
  rotateAfterDays: number;
  gracePeriodSeconds: number;
  notifyBeforeDays: number;
  provisioner: string;
}

interface RotatingCredential {
  id: string;
  name: string;
  ref: string;
  provider: string;
  lastRotated: string;
  rotation: RotationPolicy;
  status: 'healthy' | 'due_soon' | 'overdue';
}

const DEMO_CREDS: RotatingCredential[] = [
  {
    id: 'cred-openai-prod',
    name: 'OpenAI Production',
    ref: 'openai-prod-slot',
    provider: 'openai',
    lastRotated: '2026-05-20T00:00:00Z',
    rotation: { rotateAfterDays: 30, gracePeriodSeconds: 300, notifyBeforeDays: 3, provisioner: 'vault-kv' },
    status: 'healthy',
  },
  {
    id: 'cred-anthropic-api',
    name: 'Anthropic API',
    ref: 'anthropic-prod-slot',
    provider: 'anthropic',
    lastRotated: '2026-05-01T00:00:00Z',
    rotation: { rotateAfterDays: 30, gracePeriodSeconds: 300, notifyBeforeDays: 3, provisioner: 'aws-secrets' },
    status: 'due_soon',
  },
  {
    id: 'cred-gemini-api',
    name: 'Gemini API',
    ref: 'gemini-prod-slot',
    provider: 'gemini',
    lastRotated: '2026-04-25T00:00:00Z',
    rotation: { rotateAfterDays: 30, gracePeriodSeconds: 300, notifyBeforeDays: 3, provisioner: 'vault-kv' },
    status: 'overdue',
  },
];

const PROVISIONER_LABELS: Record<string, string> = {
  'vault-kv': 'HashiCorp Vault KV',
  'aws-secrets': 'AWS Secrets Manager',
  'azure-kv': 'Azure Key Vault',
};

type LogLine = { time: string; text: string; ok: boolean };

export function RotationTab() {
  const [selectedId, setSelectedId] = useState('cred-openai-prod');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  const selected = DEMO_CREDS.find((c) => c.id === selectedId)!;

  const daysSince = (iso: string) =>
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

  const daysLeft = (c: RotatingCredential) =>
    Math.max(0, c.rotation.rotateAfterDays - daysSince(c.lastRotated));

  const pct = (c: RotatingCredential) =>
    Math.min(100, (daysSince(c.lastRotated) / c.rotation.rotateAfterDays) * 100);

  const statusBadge = (s: RotatingCredential['status']) => {
    if (s === 'healthy') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'due_soon') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  };

  const barColor = (s: RotatingCredential['status']) => {
    if (s === 'healthy') return 'bg-emerald-400';
    if (s === 'due_soon') return 'bg-amber-400';
    return 'bg-red-400';
  };

  const triggerRotation = async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    const ts = () => new Date().toLocaleTimeString();
    const push = (text: string, ok = true) =>
      setLog((l) => [{ time: ts(), text, ok }, ...l]);

    push(`Scheduler.runOnce() — scanning ${DEMO_CREDS.length} active credentials`);
    await new Promise((r) => setTimeout(r, 600));
    push(`Found ${selected.id} — ${daysSince(selected.lastRotated)}d since last rotation (policy: ${selected.rotation.rotateAfterDays}d)`);
    await new Promise((r) => setTimeout(r, 700));
    push(`Provider "${selected.rotation.provisioner}": calling rotate(credential)…`);
    await new Promise((r) => setTimeout(r, 900));
    push(`New ref minted — storing in repository; audit event: credential.rotated`);
    await new Promise((r) => setTimeout(r, 400));
    push(`Grace period: old ref valid for ${selected.rotation.gracePeriodSeconds}s — in-flight requests complete cleanly`);
    await new Promise((r) => setTimeout(r, 300));
    push(`Grace period elapsed — old ref revoked by upstream system`);
    setRunning(false);
  };

  const snippet = `import { CredentialRotationScheduler } from '@datacules/agent-identity';
import { VaultRotationProvider } from '@datacules/agent-identity-store-vault';

const scheduler = new CredentialRotationScheduler(repository, auditLogger);

scheduler.registerProvider(
  new VaultRotationProvider({
    vaultUrl: process.env.VAULT_ADDR!,
    token:    process.env.VAULT_TOKEN!,
  })
);

// Poll every hour — rotates when lastRotated + rotateAfterDays ≤ now
scheduler.start(3_600_000);

// Or invoke on demand from a Lambda / Kubernetes CronJob
await scheduler.runOnce();`;

  const auditEvents = [
    { event: 'credential.rotation_due', desc: 'Emitted notifyBeforeDays before the rotation deadline' },
    { event: 'credential.rotated', desc: 'New ref stored; old ref still valid during grace period' },
    { event: 'credential.rotation_failed', desc: 'Provider threw — old ref remains active; retried next cycle' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Credential Rotation Scheduler</h2>
        <p className="text-sm text-gray-500">
          <code className="text-xs bg-gray-100 px-1 rounded">CredentialRotationScheduler</code> in{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">packages/core</code> detects expiring credentials,
          calls a registered <code className="text-xs bg-gray-100 px-1 rounded">RotationProvider</code> to mint a
          fresh secret, and keeps both the old and new refs valid during a configurable grace period so
          in-flight requests complete without interruption.
        </p>
      </div>

      {/* Credential list */}
      <div className="space-y-2">
        {DEMO_CREDS.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`w-full text-left border rounded-lg px-4 py-3 transition-colors ${
              selectedId === c.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-gray-400 font-mono">{c.ref}</span>
              </div>
              <span className={`text-xs border px-2 py-0.5 rounded-full ${statusBadge(c.status)}`}>
                {c.status === 'healthy' ? 'Healthy' : c.status === 'due_soon' ? 'Due soon' : 'Overdue'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor(c.status)}`} style={{ width: `${pct(c)}%` }} />
              </div>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {daysLeft(c) === 0 ? 'Overdue' : `${daysLeft(c)}d left`} · rotated {daysSince(c.lastRotated)}d ago
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Policy panel */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Rotation policy — {selected.name}</div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">Rotate after</dt><dd>{selected.rotation.rotateAfterDays} days</dd>
          <dt className="text-gray-500">Notify before</dt><dd>{selected.rotation.notifyBeforeDays} days</dd>
          <dt className="text-gray-500">Grace period</dt><dd>{selected.rotation.gracePeriodSeconds}s — both refs resolve</dd>
          <dt className="text-gray-500">Provisioner</dt><dd>{PROVISIONER_LABELS[selected.rotation.provisioner] ?? selected.rotation.provisioner}</dd>
        </dl>
      </div>

      {/* Simulator */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Rotation simulator</div>
        <button
          onClick={triggerRotation}
          disabled={running}
          className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {running ? 'Rotating…' : 'Run scheduler.runOnce()'}
        </button>
        {log.length > 0 && (
          <div className="mt-3 bg-gray-950 rounded-md p-3 space-y-1 max-h-52 overflow-y-auto">
            {log.map((l, i) => (
              <div key={i} className="flex gap-2 text-xs font-mono">
                <span className="text-gray-500 shrink-0">{l.time}</span>
                <span className={l.ok ? 'text-emerald-400' : 'text-red-400'}>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code snippet */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Integration</div>
        <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed"><code>{snippet}</code></pre>
      </div>

      {/* Audit events */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Audit events</div>
        <div className="space-y-2">
          {auditEvents.map(({ event, desc }) => (
            <div key={event} className="flex items-start gap-3">
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{event}</code>
              <span className="text-xs text-gray-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
