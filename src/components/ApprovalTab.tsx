'use client';

import { useState } from 'react';

// ─── Types (mirrors packages/core/src/types.ts) ───────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'break_glass';

interface ApprovalRequest {
  requestId: string;
  credentialId: string;
  ruleId: string;
  context: {
    userId: string;
    resourceId: string;
    action: string;
    provider: string;
    traceId: string;
  };
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  justification?: string;
  expiresAt: string;
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_REQUESTS: ApprovalRequest[] = [
  {
    requestId: 'approval-trace-001-rule-pii-write',
    credentialId: 'cred-openai-prod',
    ruleId: 'rule-pii-write',
    context: { userId: 'user-alice', resourceId: 'customer-pii-store', action: 'write', provider: 'openai', traceId: 'trace-001' },
    status: 'pending',
    requestedAt: new Date(Date.now() - 90_000).toISOString(),
    expiresAt: new Date(Date.now() + 210_000).toISOString(),
  },
  {
    requestId: 'approval-trace-002-rule-finance-delete',
    credentialId: 'cred-anthropic-prod',
    ruleId: 'rule-finance-delete',
    context: { userId: 'user-bob', resourceId: 'financial-records', action: 'delete', provider: 'anthropic', traceId: 'trace-002' },
    status: 'pending',
    requestedAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 270_000).toISOString(),
  },
  {
    requestId: 'approval-trace-003-rule-pii-read',
    credentialId: 'cred-gemini-shared',
    ruleId: 'rule-pii-read',
    context: { userId: 'user-carol', resourceId: 'customer-pii-store', action: 'read', provider: 'gemini', traceId: 'trace-003' },
    status: 'approved',
    requestedAt: new Date(Date.now() - 600_000).toISOString(),
    resolvedAt: new Date(Date.now() - 540_000).toISOString(),
    resolvedBy: 'admin@acme.com',
    expiresAt: new Date(Date.now() + 3000_000).toISOString(),
  },
  {
    requestId: 'approval-trace-004-rule-prod-admin',
    credentialId: 'cred-openai-prod',
    ruleId: 'rule-prod-admin',
    context: { userId: 'user-dave', resourceId: 'prod-database', action: 'admin', provider: 'openai', traceId: 'trace-004' },
    status: 'rejected',
    requestedAt: new Date(Date.now() - 1200_000).toISOString(),
    resolvedAt: new Date(Date.now() - 1100_000).toISOString(),
    resolvedBy: 'security@acme.com',
    justification: 'Action not permitted outside maintenance window.',
    expiresAt: new Date(Date.now() - 900_000).toISOString(),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: ApprovalStatus) {
  const map: Record<ApprovalStatus, { bg: string; text: string; label: string }> = {
    pending:     { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Pending'     },
    approved:    { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Approved'    },
    rejected:    { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Rejected'    },
    timeout:     { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Timed out'   },
    break_glass: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Break-glass' },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function timeLeft(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const m = Math.floor(diff / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ApprovalTab() {
  const [requests, setRequests] = useState<ApprovalRequest[]>(SEED_REQUESTS);
  const [selected, setSelected] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [breakGlassMode, setBreakGlassMode] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('pending');

  const pending  = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');
  const visible  = filter === 'all' ? requests : filter === 'pending' ? pending : resolved;

  function resolve(requestId: string, status: ApprovalStatus, by = 'dashboard-user') {
    setRequests((prev) =>
      prev.map((r) =>
        r.requestId === requestId
          ? { ...r, status, resolvedAt: new Date().toISOString(), resolvedBy: by, justification: justification || undefined }
          : r
      )
    );
    setSelected(null);
    setJustification('');
    setBreakGlassMode(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Approval workflows</h2>
        <p className="text-sm text-gray-500 mt-1">
          Human-in-the-loop gate for high-risk credential resolutions. Pending requests block
          resolve() until approved, rejected, or timed out.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pending',  count: pending.length, color: 'text-amber-600' },
          { label: 'Approved', count: resolved.filter((r) => r.status === 'approved' || r.status === 'break_glass').length, color: 'text-green-600' },
          { label: 'Rejected', count: resolved.filter((r) => r.status === 'rejected' || r.status === 'timeout').length, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="border border-gray-200 rounded-lg p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {(['all', 'pending', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              filter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visible.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">No {filter === 'all' ? '' : filter} requests.</p>
        )}
        {visible.map((req) => (
          <div
            key={req.requestId}
            onClick={() => setSelected(selected === req.requestId ? null : req.requestId)}
            className={`border rounded-lg p-4 cursor-pointer transition-colors ${
              selected === req.requestId ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusBadge(req.status)}
                  <span className="text-xs font-mono text-gray-400">{req.context.traceId}</span>
                </div>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {req.context.userId}
                  <span className="text-gray-400 font-normal"> → </span>
                  <span className="font-mono text-xs">{req.context.action}</span>
                  <span className="text-gray-400 font-normal"> on </span>
                  <span className="font-mono text-xs">{req.context.resourceId}</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Credential: <span className="font-mono">{req.credentialId}</span>
                  {' · '}Rule: <span className="font-mono">{req.ruleId}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">{relativeTime(req.requestedAt)}</p>
                {req.status === 'pending' && (
                  <p className="text-xs text-amber-600 mt-0.5">Expires {timeLeft(req.expiresAt)}</p>
                )}
              </div>
            </div>

            {selected === req.requestId && req.status === 'pending' && (
              <div className="mt-4 pt-4 border-t border-gray-200 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Justification (optional)</label>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Reason for approval or rejection…"
                    rows={2}
                    className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => resolve(req.requestId, 'approved')} className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 transition-colors">Approve</button>
                  <button onClick={() => resolve(req.requestId, 'rejected')} className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 transition-colors">Reject</button>
                  <button
                    onClick={() => setBreakGlassMode((v) => !v)}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      breakGlassMode ? 'bg-purple-600 text-white border-purple-600' : 'border-purple-300 text-purple-600 hover:bg-purple-50'
                    }`}
                  >
                    Break-glass
                  </button>
                </div>
                {breakGlassMode && (
                  <div className="bg-purple-50 border border-purple-200 rounded-md p-3 space-y-2">
                    <p className="text-xs text-purple-700 font-medium">Break-glass override</p>
                    <p className="text-xs text-purple-600">Bypasses normal approval flow. This action is logged as a non-deletable audit entry and will appear in compliance reports.</p>
                    <button onClick={() => resolve(req.requestId, 'break_glass', 'break-glass-operator')} className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-md hover:bg-purple-700 transition-colors">Confirm break-glass override</button>
                  </div>
                )}
              </div>
            )}

            {selected === req.requestId && req.status !== 'pending' && req.resolvedBy && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Resolved by <span className="font-medium text-gray-700">{req.resolvedBy}</span>
                  {req.resolvedAt && <> · {relativeTime(req.resolvedAt)}</>}
                </p>
                {req.justification && <p className="text-xs text-gray-500 mt-1 italic">&ldquo;{req.justification}&rdquo;</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-700 mb-2">API endpoints</p>
        <div className="space-y-1">
          {[
            { method: 'POST', path: '/api/approve',             desc: 'Approve or reject a pending request' },
            { method: 'POST', path: '/api/approve/break-glass', desc: 'Emergency override — non-deletable audit entry' },
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
