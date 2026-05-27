'use client';

import { useState } from 'react';

interface IdentityChainEntry {
  org: string;
  userId: string;
  agentId: string;
  issuedAt: string;
  signature: string;
}

interface TrustedDomain {
  domain: string;
  publicKey: string;
  description: string;
}

const SEED_DOMAINS: TrustedDomain[] = [
  { domain: 'acme.com',   publicKey: 'MCowBQYDK2VwAyEA...acme',   description: 'ACME Corp (originating org)' },
  { domain: 'vendor.com', publicKey: 'MCowBQYDK2VwAyEA...vendor', description: 'Vendor LLC (fulfillment agent)' },
  { domain: 'audit.io',   publicKey: 'MCowBQYDK2VwAyEA...audit',  description: 'Audit.io (compliance agent)' },
];

const SEED_CHAIN: IdentityChainEntry[] = [
  {
    org: 'acme.com', userId: 'user-alice', agentId: 'orders-agent',
    issuedAt: new Date(Date.now() - 120_000).toISOString(),
    signature: btoa(JSON.stringify({ org: 'acme.com', userId: 'user-alice', agentId: 'orders-agent' })),
  },
  {
    org: 'vendor.com', userId: 'user-alice', agentId: 'fulfillment-agent',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    signature: btoa(JSON.stringify({ org: 'vendor.com', userId: 'user-alice', agentId: 'fulfillment-agent' })),
  },
];

function truncate(s: string, n = 20) { return s.length > n ? s.slice(0, n) + '…' : s; }

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  return `${m}m ago`;
}

export function FederationTab() {
  const [chain, setChain] = useState<IdentityChainEntry[]>(SEED_CHAIN);
  const [trustedDomains] = useState<TrustedDomain[]>(SEED_DOMAINS);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newOrg, setNewOrg] = useState('acme.com');
  const [newUserId, setNewUserId] = useState('user-alice');
  const [newAgentId, setNewAgentId] = useState('compliance-agent');

  function verifyChain() {
    setVerifying(true);
    setVerifyResult(null);
    setTimeout(() => {
      const domainSet = new Set(trustedDomains.map((d) => d.domain));
      const allTrusted = chain.every((e) => domainSet.has(e.org));
      const allSigned  = chain.every((e) => e.signature.length > 0);
      if (!allTrusted) {
        const unknown = chain.find((e) => !domainSet.has(e.org));
        setVerifyResult({ ok: false, message: `Untrusted domain: ${unknown?.org ?? '?'}` });
      } else if (!allSigned) {
        setVerifyResult({ ok: false, message: 'One or more entries are missing a signature.' });
      } else {
        setVerifyResult({ ok: true, message: `Chain verified — ${chain.length} entries, all from trusted domains.` });
      }
      setVerifying(false);
    }, 500);
  }

  function extendChain() {
    if (!newOrg.trim() || !newUserId.trim() || !newAgentId.trim()) return;
    const entry: IdentityChainEntry = {
      org: newOrg.trim(), userId: newUserId.trim(), agentId: newAgentId.trim(),
      issuedAt: new Date().toISOString(),
      signature: btoa(JSON.stringify({ org: newOrg, userId: newUserId, agentId: newAgentId })),
    };
    setChain((prev) => [...prev, entry]);
    setVerifyResult(null);
    setNewAgentId('audit-agent');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Agent federation</h2>
        <p className="text-sm text-gray-500 mt-1">
          Cross-org identity chains carry the full principal history across trust boundaries.
          Each entry is signed by the originating org's agent-identity deployment.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-2">Registered trust domains</p>
        <div className="space-y-1">
          {trustedDomains.map((d) => (
            <div key={d.domain} className="flex items-center gap-3 py-1.5 border-b border-gray-100 last:border-0">
              <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-mono font-medium text-gray-800">{d.domain}</span>
                <span className="text-xs text-gray-400 ml-2">{d.description}</span>
              </div>
              <span className="ml-auto text-xs font-mono text-gray-300">{truncate(d.publicKey, 24)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-gray-700">Current identity chain ({chain.length} entries)</p>
          <button onClick={() => { setChain(SEED_CHAIN); setVerifyResult(null); }} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
        </div>
        {chain.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Chain is empty.</p>}
        <div className="space-y-0">
          {chain.map((entry, idx) => {
            const trusted = trustedDomains.some((d) => d.domain === entry.org);
            return (
              <div key={idx} className="relative">
                {idx < chain.length - 1 && <div className="absolute left-4 top-12 bottom-0 w-px bg-gray-200 z-0" />}
                <div className="relative z-10 flex gap-3 pb-3">
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold border-2 ${
                    trusted ? 'bg-white border-green-400 text-green-600' : 'bg-white border-red-300 text-red-500'
                  }`}>{idx + 1}</div>
                  <div className="flex-1 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium text-gray-900">{entry.org}</span>
                          {trusted ? <span className="text-xs text-green-600">✓ trusted</span> : <span className="text-xs text-red-500">⚠ unknown domain</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-mono">{entry.userId}</span>
                          <span className="text-gray-300 mx-1">→</span>
                          <span className="font-mono">{entry.agentId}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{relativeTime(entry.issuedAt)}</span>
                        <button onClick={() => { setChain((prev) => prev.filter((_, i) => i !== idx)); setVerifyResult(null); }} className="text-gray-300 hover:text-red-400 text-xs" title="Remove">✕</button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">sig:</span>
                      <span className="text-xs font-mono text-gray-300">{truncate(entry.signature, 32)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={verifyChain} disabled={verifying || chain.length === 0}
          className={`px-4 py-2 text-sm rounded-md border transition-colors ${
            chain.length === 0 ? 'border-gray-200 text-gray-300 cursor-not-allowed'
            : 'border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white'
          }`}>
          {verifying ? 'Verifying…' : 'Verify chain'}
        </button>
      </div>

      {verifyResult && (
        <div className={`rounded-lg p-3 border text-sm ${
          verifyResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {verifyResult.ok ? '✓ ' : '✕ '}{verifyResult.message}
        </div>
      )}

      <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-gray-700">Extend chain — add an entry</p>
        <div className="grid grid-cols-3 gap-2">
          {[['Trust domain', newOrg, setNewOrg, 'acme.com'], ['User ID', newUserId, setNewUserId, 'user-alice'], ['Agent ID', newAgentId, setNewAgentId, 'audit-agent']].map(([label, value, setter, placeholder]) => (
            <div key={label as string}>
              <label className="block text-xs text-gray-400 mb-1">{label as string}</label>
              <input value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400" placeholder={placeholder as string} />
            </div>
          ))}
        </div>
        <button onClick={extendChain} className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors">Extend chain</button>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-700 mb-2">API endpoints</p>
        <div className="space-y-1">
          {[
            { method: 'POST', path: '/api/federation/issue',  desc: 'Issue a new identity chain' },
            { method: 'POST', path: '/api/federation/verify', desc: 'Verify an inbound identity chain' },
          ].map((e) => (
            <div key={e.path} className="flex items-start gap-2">
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
