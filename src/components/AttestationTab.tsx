'use client';

import { useState, useEffect, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AttestationPayload {
  iss?: string;
  sub?: string;
  credentialId?: string;
  resolvedFor?: string;
  action?: string;
  resourceId?: string;
  traceId?: string;
  ruleId?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

interface VerifyResult {
  valid: boolean;
  expired: boolean;
  payload: AttestationPayload | null;
  error?: string;
  remainingSeconds?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeJwtPayload(token: string): AttestationPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as AttestationPayload;
  } catch {
    return null;
  }
}

function formatTs(unix?: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString();
}

function ExpiryBadge({ exp }: { exp?: number }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!exp) return;
    const tick = () => setRemaining(Math.floor(exp - Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exp]);

  if (remaining === null) return null;
  const expired = remaining <= 0;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      expired ? 'bg-red-100 text-red-700' : remaining < 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        expired ? 'bg-red-500' : remaining < 60 ? 'bg-yellow-500' : 'bg-green-500'
      }`} />
      {expired ? 'Expired' : `Expires in ${remaining}s`}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AttestationTab() {
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('dev-secret-change-in-production');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signMode, setSignMode] = useState(false);
  // Sign form
  const [signUserId, setSignUserId] = useState('user-abc');
  const [signCredId, setSignCredId] = useState('cred-linear');
  const [signAction, setSignAction] = useState('read');
  const [signResource, setSignResource] = useState('knowledge-base');
  const [signTraceId, setSignTraceId] = useState('trace-' + Math.random().toString(36).slice(2, 10));
  const [signing, setSigning] = useState(false);
  const [signedToken, setSignedToken] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Verify ────────────────────────────────────────────────────────────────
  async function handleVerify() {
    const t = token.trim();
    if (!t) return;
    setVerifying(true);
    setResult(null);
    try {
      const res = await fetch('/api/attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, secret }),
      });
      const data = await res.json() as VerifyResult;
      setResult(data);
    } catch {
      // Server not available — decode client-side only (no signature check)
      const payload = decodeJwtPayload(t);
      const now = Math.floor(Date.now() / 1000);
      setResult({
        valid: false,
        expired: payload?.exp ? payload.exp < now : false,
        payload,
        error: 'Could not reach /api/attest — showing decoded payload only (signature not verified)',
      });
    } finally {
      setVerifying(false);
    }
  }

  // ── Sign (demo) ───────────────────────────────────────────────────────────
  async function handleSign() {
    setSigning(true);
    setSignedToken('');
    try {
      const res = await fetch('/api/attest/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          userId: signUserId,
          credentialId: signCredId,
          action: signAction,
          resourceId: signResource,
          traceId: signTraceId,
        }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (data.token) {
        setSignedToken(data.token);
        setToken(data.token);
        setResult(null);
      }
    } finally {
      setSigning(false);
    }
  }

  function copyToken(t: string) {
    navigator.clipboard.writeText(t).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold mb-1">Zero-trust credential attestation</h2>
        <p className="text-sm text-gray-500">
          Every <code className="text-xs bg-gray-100 px-1 rounded">resolve()</code> call can sign a short-lived HMAC-SHA256 JWT.
          Downstream services verify the token independently — no round-trip to agent-identity required.
          The proof travels with every request.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSignMode(false)}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            !signMode ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
          }`}
        >
          Verify token
        </button>
        <button
          onClick={() => setSignMode(true)}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            signMode ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
          }`}
        >
          Sign (demo)
        </button>
      </div>

      {/* Shared secret field */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">HMAC secret</label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-gray-900"
          placeholder="your-deployment-secret"
        />
        <p className="text-xs text-gray-400 mt-1">Used for HMAC-SHA256 signing. Never leave the server in production.</p>
      </div>

      {/* Sign mode */}
      {signMode && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Attestation payload</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'User ID', value: signUserId, set: setSignUserId, placeholder: 'user-abc' },
              { label: 'Credential ID', value: signCredId, set: setSignCredId, placeholder: 'cred-linear' },
              { label: 'Action', value: signAction, set: setSignAction, placeholder: 'read' },
              { label: 'Resource ID', value: signResource, set: setSignResource, placeholder: 'knowledge-base' },
              { label: 'Trace ID', value: signTraceId, set: setSignTraceId, placeholder: 'trace-xyz' },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleSign}
            disabled={signing}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {signing ? 'Signing…' : 'Sign attestation'}
          </button>
          {signedToken && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-600">Signed token</p>
                <button onClick={() => copyToken(signedToken)} className="text-xs text-gray-400 hover:text-gray-600">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-2 break-all text-gray-700">
                {signedToken}
              </p>
              <p className="text-xs text-gray-400 mt-1">Token auto-loaded into the verify field below.</p>
            </div>
          )}
        </div>
      )}

      {/* Verify mode */}
      {!signMode && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Attestation token (JWT)</label>
            <textarea
              ref={textareaRef}
              value={token}
              onChange={(e) => { setToken(e.target.value); setResult(null); }}
              rows={4}
              className="w-full text-xs font-mono border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            />
          </div>
          <button
            onClick={handleVerify}
            disabled={!token.trim() || verifying}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {verifying ? 'Verifying…' : 'Verify token'}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`border rounded-lg p-4 space-y-3 ${
          result.valid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-semibold ${
              result.valid ? 'text-green-700' : 'text-red-700'
            }`}>
              {result.valid ? '✓ Valid attestation' : '✗ Invalid attestation'}
            </span>
            {result.payload?.exp && <ExpiryBadge exp={result.payload.exp} />}
          </div>

          {result.error && (
            <p className="text-xs text-red-600">{result.error}</p>
          )}

          {result.payload && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Decoded payload</p>
              <div className="grid gap-1.5">
                {([
                  ['Issuer (iss)', result.payload.iss],
                  ['Subject (sub)', result.payload.sub],
                  ['Credential ID', result.payload.credentialId],
                  ['Resolved for', result.payload.resolvedFor],
                  ['Action', result.payload.action],
                  ['Resource ID', result.payload.resourceId],
                  ['Trace ID', result.payload.traceId],
                  ['Rule ID', result.payload.ruleId],
                  ['Issued at', formatTs(result.payload.iat)],
                  ['Expires at', formatTs(result.payload.exp)],
                ] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) => (
                  <div key={label} className="flex text-xs">
                    <span className="w-28 shrink-0 text-gray-400">{label}</span>
                    <span className="font-mono text-gray-700 break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="border border-gray-100 rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">How it works</p>
        <ol className="space-y-1.5 text-sm text-gray-600">
          {[
            'Configure an AttestationSigner on the router with a deployment secret (or KMS key).',
            'Every resolve() call signs a 5-minute JWT containing the userId, credentialId, action, resourceId, and traceId.',
            'The credentialAttestation field on ResolvedCredential carries the signed token.',
            'Downstream services call verifyAttestation(token, signer) — no network round-trip required.',
            'The agent cannot forge a resolved identity — cryptographic proof travels with every request.',
          ].map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center font-medium">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

    </div>
  );
}
