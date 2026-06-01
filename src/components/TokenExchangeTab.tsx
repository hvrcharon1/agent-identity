'use client';

import { useState, useCallback } from 'react';

// ─── Types (mirrored from @datacules/agent-identity-token-exchange) ──────────

type CredentialKind   = 'fixed' | 'user-delegated';
type CredentialStatus = 'active' | 'pending' | 'revoked';

interface TokenExchangeConfig {
  ref:              string;
  name:             string;
  kind:             CredentialKind;
  scope:            string;
  status:           CredentialStatus;
  provider?:        string;
  tokenEndpoint:    string;
  clientId:         string;
  clientSecret?:    string;
  requestedScopes:  string[];
  audience?:        string;
  subjectTokenType?: string;
  extraParams?:     Record<string, string>;
}

interface ExchangeResult {
  credentialId:  string;
  kind:          CredentialKind;
  scope:         string;
  resolvedFor:   string;
  expiresAt:     string;
  exchangedRef:  string;   // the actual access_token (truncated for display)
  fromCache:     boolean;
  latencyMs:     number;
}

type AsType = 'keycloak' | 'auth0' | 'azure' | 'okta';

// ─── Demo exchange configurations ────────────────────────────────────────────

const DEMO_CONFIGS: TokenExchangeConfig[] = [
  {
    ref:             'crm-service-token',
    name:            'CRM Service',
    kind:            'user-delegated',
    scope:           'crm:read crm:write',
    status:          'active',
    provider:        'openai',
    tokenEndpoint:   'https://auth.acme.com/realms/prod/protocol/openid-connect/token',
    clientId:        'agent-identity-client',
    clientSecret:    'supersecret',
    requestedScopes: ['crm:read', 'crm:write'],
    audience:        'https://crm.acme.com',
  },
  {
    ref:             'analytics-token',
    name:            'Analytics (read-only)',
    kind:            'fixed',
    scope:           'analytics:read',
    status:          'active',
    provider:        'anthropic',
    tokenEndpoint:   'https://acme.us.auth0.com/oauth/token',
    clientId:        'analytics-agent',
    clientSecret:    'auth0secret',
    requestedScopes: ['analytics:read'],
    audience:        'https://analytics.acme.com',
  },
  {
    ref:             'datawarehouse-token',
    name:            'Data Warehouse',
    kind:            'user-delegated',
    scope:           'dw:query dw:export',
    status:          'active',
    provider:        'openai',
    tokenEndpoint:   'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
    clientId:        'dw-agent-client',
    clientSecret:    'azuresecret',
    requestedScopes: ['https://synapse.azure.com/.default'],
    audience:        'https://synapse.azure.com',
    subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    extraParams:     { requested_token_use: 'on_behalf_of' },
  },
];

// ─── AS-specific config snippets ─────────────────────────────────────────────

const AS_CONFIGS: Record<AsType, { label: string; endpoint: string; note: string }> = {
  keycloak: {
    label:    'Keycloak',
    endpoint: 'https://auth.example.com/realms/{realm}/protocol/openid-connect/token',
    note:     'Enable token exchange in Realm Settings → Client Policies → token-exchange.',
  },
  auth0: {
    label:    'Auth0 (Enterprise)',
    endpoint: 'https://{domain}.us.auth0.com/oauth/token',
    note:     'Requires Auth0 Enterprise with Token Exchange extension enabled.',
  },
  azure: {
    label:    'Azure AD / Entra ID (OBO)',
    endpoint: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
    note:     'Add extraParams: { requested_token_use: "on_behalf_of" } for OBO flow.',
  },
  okta: {
    label:    'Okta (Token Exchange)',
    endpoint: 'https://{domain}/oauth2/{authServerId}/v1/token',
    note:     'Requires Custom Authorization Server with token exchange policy.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateToken(token: string): string {
  return token.slice(0, 14) + '...' + token.slice(-6);
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 'eyJ' + Array.from({ length: 180 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function addSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ─── Mock exchange (simulates TokenExchangeStore.findByRef) ───────────────────

function mockExchange(
  cfg: TokenExchangeConfig,
  subjectToken: string,
  fromCache: boolean,
): ExchangeResult {
  const start = Date.now();
  const latencyMs = fromCache ? Math.round(Math.random() * 2 + 1) : Math.round(Math.random() * 120 + 40);
  return {
    credentialId:  `token-exchange:${cfg.ref}`,
    kind:          cfg.kind,
    scope:         cfg.scope,
    resolvedFor:   cfg.kind === 'user-delegated' ? 'user-alice' : 'service',
    expiresAt:     addSeconds(3600),
    exchangedRef:  truncateToken(generateToken()),
    fromCache,
    latencyMs,
  };
  void start;
}

// ─── Code generator ────────────────────────────────────────────────────────────

function generateSnippet(cfg: TokenExchangeConfig, as: AsType): string {
  const endpoint = AS_CONFIGS[as].endpoint
    .replace('{realm}', 'prod')
    .replace('{domain}', 'acme')
    .replace('{tenantId}', 'YOUR_TENANT_ID')
    .replace('{authServerId}', 'default');

  const extras = cfg.extraParams
    ? `\n    extraParams: ${JSON.stringify(cfg.extraParams)},`
    : '';

  return `import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
import { createRouterFromStore }    from '@datacules/agent-identity';

// In your API route handler — subjectToken comes from the request:
const subjectToken = req.headers.authorization?.replace('Bearer ', '');

const store = new TokenExchangeStore({
  configs: [
    {
      ref:             '${cfg.ref}',
      name:            '${cfg.name}',
      kind:            '${cfg.kind}',
      scope:           '${cfg.scope}',
      status:          'active',
      tokenEndpoint:   '${endpoint}',
      clientId:        process.env.CLIENT_ID!,
      clientSecret:    process.env.CLIENT_SECRET!,
      requestedScopes: ${JSON.stringify(cfg.requestedScopes)},${cfg.audience ? `
      audience:        '${cfg.audience}',` : ''}${extras}
    },
  ],
  subjectTokenProvider: async (_ref) => subjectToken ?? null,
});

const router  = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
// resolved.ref IS the exchanged access_token — injected server-side,
// never returned to the model or the client.`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CredentialStatus }) {
  const cls: Record<CredentialStatus, string> = {
    active:  'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    revoked: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls[status]}`}>
      {status}
    </span>
  );
}

function KindBadge({ kind }: { kind: CredentialKind }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
      kind === 'user-delegated'
        ? 'bg-purple-50 text-purple-700 border-purple-100'
        : 'bg-gray-100 text-gray-600 border-gray-200'
    }`}>
      {kind}
    </span>
  );
}

function ConfigCard({
  cfg, selected, onSelect,
}: {
  cfg: TokenExchangeConfig;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`border rounded-lg p-3 cursor-pointer transition-colors ${
        selected
          ? 'border-gray-900 bg-gray-50'
          : 'border-gray-200 hover:border-gray-400'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{cfg.name}</span>
        <div className="flex items-center gap-1.5">
          <KindBadge kind={cfg.kind} />
          <StatusBadge status={cfg.status} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>ref: <span className="font-mono text-gray-700">{cfg.ref}</span></span>
        <span>scope: <span className="font-mono text-gray-700">{cfg.scope}</span></span>
        {cfg.provider && (
          <span>provider: <span className="font-mono text-gray-700">{cfg.provider}</span></span>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: ExchangeResult }) {
  return (
    <div className="border border-green-100 bg-green-50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-green-800">Token exchanged successfully</p>
        <div className="flex items-center gap-2">
          {result.fromCache && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
              cache hit
            </span>
          )}
          <span className="text-xs text-gray-500">{result.latencyMs} ms</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Credential ID',  value: result.credentialId },
          { label: 'Resolved for',   value: result.resolvedFor },
          { label: 'Kind',           value: result.kind },
          { label: 'Scope',          value: result.scope },
          { label: 'Expires at',     value: new Date(result.expiresAt).toLocaleTimeString() },
          { label: 'ref (token)',     value: result.exchangedRef },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded border border-green-100 p-2">
            <p className="text-gray-400 mb-0.5">{label}</p>
            <p className="font-mono text-gray-800 break-all">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-green-700">
        The <code className="bg-green-100 px-1 rounded">ref</code> field above IS the exchanged
        access_token — ready for server-side injection. It is never returned to the client or model layer.
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TokenExchangeTab() {
  const [selectedRef, setSelectedRef]   = useState(DEMO_CONFIGS[0].ref);
  const [selectedAs, setSelectedAs]     = useState<AsType>('keycloak');
  const [subjectToken, setSubjectToken] = useState(
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWFsaWNlIn0.demo',
  );
  const [result, setResult]             = useState<ExchangeResult | null>(null);
  const [cacheHit, setCacheHit]         = useState(false);
  const [exchanging, setExchanging]     = useState(false);
  const [copyDone, setCopyDone]         = useState(false);

  const selectedConfig = DEMO_CONFIGS.find(c => c.ref === selectedRef)!;
  const snippet        = generateSnippet(selectedConfig, selectedAs);

  const runExchange = useCallback(() => {
    if (!subjectToken.trim()) return;
    setExchanging(true);
    setTimeout(() => {
      const newResult = mockExchange(selectedConfig, subjectToken, cacheHit);
      setResult(newResult);
      setCacheHit(true);  // subsequent calls return from cache
      setExchanging(false);
    }, cacheHit ? 30 : Math.round(Math.random() * 120 + 80));
  }, [selectedConfig, subjectToken, cacheHit]);

  const handleInvalidateCache = useCallback(() => {
    setCacheHit(false);
    setResult(null);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1800);
    } catch {
      // clipboard not available in all contexts
    }
  }, [snippet]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold mb-1">Token exchange</h2>
        <p className="text-sm text-gray-500">
          RFC 8693 OAuth 2.0 Token Exchange — presents a user&apos;s existing access or ID
          token to an Authorization Server and receives a narrowly-scoped downstream token
          in return. No stored secrets. The exchanged token is injected server-side and
          never returned to the model or client layer.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="border border-gray-100 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">Exchange flow</p>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {[
            { label: '1. Agent request',        sub: 'AgentRequestContext + Bearer token',       cls: 'bg-gray-50 border-gray-200' },
            { label: '2. subjectTokenProvider', sub: 'returns user\'s current access/ID token',   cls: 'bg-blue-50 border-blue-100' },
            { label: '3. RFC 8693 POST',         sub: 'grant_type=token-exchange to AS endpoint', cls: 'bg-purple-50 border-purple-100' },
            { label: '4. AS returns token',      sub: 'scoped access_token + expires_in',        cls: 'bg-amber-50 border-amber-100' },
            { label: '5. Credential returned',   sub: 'ref = exchanged token (server-side only)',  cls: 'bg-green-50 border-green-100' },
          ].map(({ label, sub, cls }, i, arr) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`border rounded-lg px-3 py-2 ${cls}`}>
                <p className="font-medium text-gray-700">{label}</p>
                <p className="text-gray-500 mt-0.5">{sub}</p>
              </div>
              {i < arr.length - 1 && (
                <span className="text-gray-300 text-base">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Exchange slot picker */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Exchange configurations</p>
        {DEMO_CONFIGS.map(cfg => (
          <ConfigCard
            key={cfg.ref}
            cfg={cfg}
            selected={selectedRef === cfg.ref}
            onSelect={() => { setSelectedRef(cfg.ref); setResult(null); setCacheHit(false); }}
          />
        ))}
      </div>

      {/* Interactive exchange simulator */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Simulate findByRef()</p>
        <p className="text-sm text-gray-500">
          Enter a subject token below (e.g. the user&apos;s current Bearer token from your request
          context). The store will exchange it for a scoped token at the configured AS.
        </p>

        <div className="space-y-2">
          <label className="block text-xs text-gray-500">Subject token (user&apos;s access/ID token)</label>
          <input
            type="text"
            value={subjectToken}
            onChange={e => { setSubjectToken(e.target.value); setResult(null); setCacheHit(false); }}
            placeholder="eyJhbGciOiJSUzI1NiJ9..."
            className="w-full text-xs font-mono border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runExchange}
            disabled={exchanging || !subjectToken.trim()}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            {exchanging ? 'Exchanging…' : 'Run exchange'}
          </button>
          {cacheHit && (
            <>
              <span className="text-xs text-blue-600">✔ Token cached. Next call will be a cache hit.</span>
              <button
                onClick={handleInvalidateCache}
                className="text-xs text-red-500 hover:text-red-700 underline"
              >
                invalidateCache()
              </button>
            </>
          )}
          {!cacheHit && result && (
            <span className="text-xs text-gray-400">Cache cleared. Next call will re-exchange.</span>
          )}
        </div>

        {result && <ResultCard result={result} />}
      </div>

      {/* Authorization Server examples */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Authorization Server</p>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(AS_CONFIGS) as AsType[]).map(as => (
            <button
              key={as}
              onClick={() => setSelectedAs(as)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                selectedAs === as
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              {AS_CONFIGS[as].label}
            </button>
          ))}
        </div>
        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
          <p className="text-xs font-mono text-gray-600 break-all">{AS_CONFIGS[selectedAs].endpoint}</p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            {AS_CONFIGS[selectedAs].note}
          </p>
        </div>
      </div>

      {/* Code snippet */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">
            TypeScript — {AS_CONFIGS[selectedAs].label} · {selectedConfig.name}
          </p>
          <button
            onClick={handleCopy}
            className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2 py-0.5 transition-colors"
          >
            {copyDone ? '✔ Copied' : 'Copy'}
          </button>
        </div>
        <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto text-gray-700 leading-relaxed">
          {snippet}
        </pre>
      </div>

      {/* Cache behaviour explainer */}
      <div className="border border-gray-100 rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Cache behaviour</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            {
              title:   'First call (cache miss)',
              body:    'subjectTokenProvider() is called, then a real RFC 8693 POST is made to the AS. Result cached with expiry derived from expires_in.',
              cls:     'bg-amber-50 border-amber-100',
            },
            {
              title:   'Subsequent calls (cache hit)',
              body:    'No HTTP request. Cached token returned immediately. Token is evicted 30 seconds before its expiry to allow proactive refresh.',
              cls:     'bg-blue-50 border-blue-100',
            },
            {
              title:   'invalidateCache(ref)',
              body:    'Evicts one slot. Call after a downstream 401, when you know the upstream token was refreshed, or after a scope change.',
              cls:     'bg-gray-50 border-gray-200',
            },
            {
              title:   'flushCache()',
              body:    'Evicts all cached tokens. Use in test teardown or after a full user re-authentication event.',
              cls:     'bg-gray-50 border-gray-200',
            },
          ].map(({ title, body, cls }) => (
            <div key={title} className={`border rounded-lg p-3 ${cls}`}>
              <p className="font-medium text-gray-700 mb-1">{title}</p>
              <p className="text-gray-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Explainer */}
      <div className="border border-gray-100 rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">How it works</p>
        <ul className="space-y-1.5 text-sm text-gray-600">
          {[
            'TokenExchangeStore implements the standard CredentialStore interface — drop-in replacement for MemoryCredentialStore, VaultCredentialStore, or AwsCredentialStore.',
            'The SubjectTokenProvider is a closure over your request context. It is called on every cache miss to obtain the user\'s current access or ID token.',
            'RFC 8693 form body: grant_type=urn:ietf:params:oauth:grant-type:token-exchange, subject_token, subject_token_type, scope, audience, client_id, client_secret.',
            'The exchanged access_token becomes the Credential.ref. The provider adapter injects it server-side as an Authorization header — it never reaches the model layer.',
            'No long-lived secrets are stored. A full store compromise yields zero usable credentials — each exchange mints a fresh scoped token at request time.',
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
