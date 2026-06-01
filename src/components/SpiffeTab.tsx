'use client';

import { useState } from 'react';

interface TrustDomain {
  domain: string;
  description: string;
  patterns: string[];
}

const TRUST_DOMAINS: TrustDomain[] = [
  {
    domain: 'acme.com',
    description: 'Production cluster — Kubernetes workloads on GKE',
    patterns: [
      'spiffe://acme.com/ns/production/sa/orders-agent',
      'spiffe://acme.com/ns/production/sa/analytics-agent',
      'spiffe://acme.com/agent/crm-*',
    ],
  },
  {
    domain: 'staging.acme.com',
    description: 'Staging cluster — EKS, node-level TPM attestation',
    patterns: [
      'spiffe://staging.acme.com/ns/staging/sa/orders-agent',
      'spiffe://staging.acme.com/agent/*',
    ],
  },
];

const ROUTING_RULES = [
  { id: 'rule-orders', matchSpiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent', credentialRef: 'orders-db-slot', priority: 90 },
  { id: 'rule-crm',    matchSpiffeId: 'spiffe://acme.com/agent/crm-*',                 credentialRef: 'crm-api-slot',   priority: 80 },
  { id: 'rule-any',    matchSpiffeId: 'spiffe://acme.com/*',                            credentialRef: 'default-slot',   priority: 10 },
];

const DEMO_SVID = {
  spiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent',
  trustDomain: 'acme.com',
  notBefore: '2026-06-02T08:00:00Z',
  notAfter:  '2026-06-02T09:00:00Z',
  serial: '4a:9f:2b:c7:e1:03:88:1d',
  signatureAlg: 'ECDSA-P256-SHA256',
  autoRenewAt: '2026-06-02T08:50:00Z',
};

export function SpiffeTab() {
  const [selectedDomain, setSelectedDomain] = useState('acme.com');
  const [matchInput, setMatchInput] = useState('spiffe://acme.com/ns/production/sa/orders-agent');
  const [matchResult, setMatchResult] = useState<string | null>(null);

  const domainInfo = TRUST_DOMAINS.find((d) => d.domain === selectedDomain)!;

  const matchRule = () => {
    for (const rule of ROUTING_RULES) {
      const pattern = rule.matchSpiffeId;
      const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      if (regex.test(matchInput)) {
        setMatchResult(`Matched rule "${rule.id}" → credentialRef: ${rule.credentialRef} (priority ${rule.priority})`);
        return;
      }
    }
    setMatchResult('No rule matched — resolve() returns null');
  };

  const snippet = `import { SpiffeCredentialStore } from '@datacules/agent-identity-store-spiffe';
import { createRouterFromStore } from '@datacules/agent-identity';
import type { RoutingRule } from '@datacules/agent-identity';

const store = new SpiffeCredentialStore({
  spiffeEndpointSocket: 'unix:///run/spire/sockets/agent.sock',
  trustDomain:          'acme.com',
});

const rules: RoutingRule[] = [
  {
    id:             'rule-orders-agent',
    matchSpiffeId:  'spiffe://acme.com/ns/production/sa/orders-agent',
    credentialRef:  'orders-db-slot',
    credentialKind: 'fixed',
    priority:       90,
  },
  {
    id:             'rule-crm-agents',
    matchSpiffeId:  'spiffe://acme.com/agent/crm-*',  // glob pattern
    credentialRef:  'crm-api-slot',
    credentialKind: 'fixed',
    priority:       80,
  },
];

const router = createRouterFromStore(store, rules, logger);
// SVID obtained from SPIRE agent — renewed automatically 10 min before expiry
const resolved = await router.resolveAsync(ctx);
// resolved.spiffeId written to AuditLogEntry for workload-level traceability`;

  const nowMs = Date.now();
  const notAfterMs = new Date(DEMO_SVID.notAfter).getTime();
  const notBeforeMs = new Date(DEMO_SVID.notBefore).getTime();
  const totalMs = notAfterMs - notBeforeMs;
  const elapsedPct = Math.min(100, Math.max(0, ((nowMs - notBeforeMs) / totalMs) * 100));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">SPIFFE / SPIRE Workload Identity</h2>
        <p className="text-sm text-gray-500">
          <code className="text-xs bg-gray-100 px-1 rounded">SpiffeCredentialStore</code> from{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">@datacules/agent-identity-store-spiffe</code> obtains
          X.509 SVIDs from a local SPIRE agent socket. SVIDs are short-lived certificates that cryptographically
          prove the workload's identity — no static secrets stored anywhere. Auto-renewed before expiry;
          works identically across AWS, GCP, Azure, and on-prem.
        </p>
      </div>

      {/* Trust domain registry */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Trust domain registry</div>
        <div className="flex gap-2 mb-3">
          {TRUST_DOMAINS.map((d) => (
            <button
              key={d.domain}
              onClick={() => setSelectedDomain(d.domain)}
              className={`px-3 py-1.5 rounded-md text-xs border font-mono transition-colors ${
                selectedDomain === d.domain
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {d.domain}
            </button>
          ))}
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-2">{domainInfo.description}</p>
          <div className="space-y-1">
            {domainInfo.patterns.map((p) => (
              <code key={p} className="block text-xs font-mono bg-gray-50 px-2 py-1 rounded text-gray-700">{p}</code>
            ))}
          </div>
        </div>
      </div>

      {/* SVID display */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Active SVID (X.509 certificate)</div>
        <div className="border border-gray-200 rounded-lg p-4 space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-gray-400">Subject URI SAN</dt>
            <dd className="font-mono text-gray-700">{DEMO_SVID.spiffeId}</dd>
            <dt className="text-gray-400">Trust domain</dt>
            <dd className="font-mono text-gray-700">{DEMO_SVID.trustDomain}</dd>
            <dt className="text-gray-400">Not before</dt>
            <dd className="text-gray-600">{new Date(DEMO_SVID.notBefore).toLocaleTimeString()}</dd>
            <dt className="text-gray-400">Not after</dt>
            <dd className="text-gray-600">{new Date(DEMO_SVID.notAfter).toLocaleTimeString()}</dd>
            <dt className="text-gray-400">Serial</dt>
            <dd className="font-mono text-gray-600">{DEMO_SVID.serial}</dd>
            <dt className="text-gray-400">Signature</dt>
            <dd className="text-gray-600">{DEMO_SVID.signatureAlg}</dd>
            <dt className="text-gray-400">Auto-renew at</dt>
            <dd className="text-gray-600">{new Date(DEMO_SVID.autoRenewAt).toLocaleTimeString()} (10 min before expiry)</dd>
          </dl>
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Certificate lifetime</span>
              <span>{DEMO_SVID.notAfter.slice(11, 16)} UTC expiry</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-sky-400 rounded-full" style={{ width: `${elapsedPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* matchSpiffeId matcher */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">matchSpiffeId rule matcher</div>
        <div className="flex gap-2">
          <input
            value={matchInput}
            onChange={(e) => { setMatchInput(e.target.value); setMatchResult(null); }}
            className="flex-1 text-xs font-mono border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
            placeholder="spiffe://acme.com/..."
          />
          <button onClick={matchRule} className="px-3 py-2 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors">
            Match
          </button>
        </div>
        {matchResult && (
          <p className={`mt-2 text-xs px-3 py-2 rounded-md ${
            matchResult.startsWith('Matched')
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {matchResult}
          </p>
        )}
        <div className="mt-2 text-xs text-gray-400">Routing rules tried in priority order (highest first):</div>
        <div className="mt-1 space-y-1">
          {ROUTING_RULES.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-xs">
              <span className="text-gray-400 font-mono w-5 text-right">{r.priority}</span>
              <code className="bg-gray-50 px-2 py-0.5 rounded text-gray-700">{r.matchSpiffeId}</code>
              <span className="text-gray-400">→ {r.credentialRef}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Code snippet */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Integration</div>
        <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed"><code>{snippet}</code></pre>
      </div>
    </div>
  );
}
