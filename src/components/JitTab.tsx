'use client';

import { useState, useEffect } from 'react';

interface Provisioner {
  id: string;
  name: string;
  label: string;
  description: string;
  ttlSeconds: number;
  configLines: string[];
}

const PROVISIONERS: Provisioner[] = [
  {
    id: 'vault',
    name: 'Vault Dynamic Secrets',
    label: 'VaultDynamicProvisioner',
    description:
      'Calls the Vault database secrets engine to mint a short-lived DB credential scoped to a specific role. '
      + 'Vault automatically revokes the credential when the TTL expires — no cleanup code required.',
    ttlSeconds: 1800,
    configLines: [
      "import { DynamicCredentialStore } from '@datacules/agent-identity-store-dynamic';",
      "import { VaultDynamicProvisioner } from '@datacules/agent-identity-store-dynamic';",
      '',
      'const store = new DynamicCredentialStore({',
      "  provisioner: new VaultDynamicProvisioner({",
      "    vaultUrl: process.env.VAULT_ADDR!,",
      "    token:    process.env.VAULT_TOKEN!,",
      "    mount:   'database',",
      "    role:    'crm-readonly',",
      "    ttl:     '30m',",
      '  }),',
      '});',
    ],
  },
  {
    id: 'aws',
    name: 'AWS IAM Roles Anywhere',
    label: 'AwsIamRolesAnywhereProvisioner',
    description:
      'Issues temporary IAM role credentials via IAM Roles Anywhere using an X.509 certificate for '
      + 'authentication. No long-lived AWS access keys are stored; credentials expire automatically.',
    ttlSeconds: 3600,
    configLines: [
      "import { DynamicCredentialStore } from '@datacules/agent-identity-store-dynamic';",
      "import { AwsIamRolesAnywhereProvisioner } from '@datacules/agent-identity-store-dynamic';",
      '',
      'const store = new DynamicCredentialStore({',
      '  provisioner: new AwsIamRolesAnywhereProvisioner({',
      "    profileArn:     'arn:aws:rolesanywhere:us-east-1:123:profile/\u2026',",
      "    roleArn:        'arn:aws:iam::123:role/AgentReadRole',",
      "    trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:123:trust-anchor/\u2026',",
      "    certPem:        process.env.AGENT_CERT_PEM!,",
      "    keyPem:         process.env.AGENT_KEY_PEM!,",
      '  }),',
      '});',
    ],
  },
  {
    id: 'azure',
    name: 'Azure Managed Identity',
    label: 'AzureManagedIdentityProvisioner',
    description:
      "Fetches MSAL access tokens for a specified Azure AD application using the workload's managed "
      + 'identity. Zero secrets stored \u2014 the identity is attested by the Azure compute fabric.',
    ttlSeconds: 3600,
    configLines: [
      "import { DynamicCredentialStore } from '@datacules/agent-identity-store-dynamic';",
      "import { AzureManagedIdentityProvisioner } from '@datacules/agent-identity-store-dynamic';",
      '',
      'const store = new DynamicCredentialStore({',
      '  provisioner: new AzureManagedIdentityProvisioner({',
      "    clientId: process.env.AZURE_CLIENT_ID!,",
      "    scope:    'https://graph.microsoft.com/.default',",
      '  }),',
      '});',
    ],
  },
];

type ProvisionState = 'idle' | 'provisioning' | 'cached' | 'expired';

export function JitTab() {
  const [activeId, setActiveId] = useState('vault');
  const [state, setState] = useState<ProvisionState>('idle');
  const [ttlLeft, setTtlLeft] = useState(0);
  const [ref, setRef] = useState('');

  const provisioner = PROVISIONERS.find((p) => p.id === activeId)!;

  // Start the countdown when state transitions to 'cached'.
  // ttlLeft is read only through the functional updater (prev => prev - 1),
  // so it does not need to be in the deps array — one interval per provision
  // lifecycle rather than one per tick.
  useEffect(() => {
    if (state !== 'cached') return;
    const t = setInterval(() => {
      setTtlLeft((prev) => {
        if (prev <= 1) { setState('expired'); clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  const provision = async () => {
    if (state === 'provisioning') return;
    setState('provisioning');
    await new Promise((r) => setTimeout(r, 1200));
    const mockRef = `jit-${activeId}-${Math.random().toString(36).slice(2, 9)}`;
    setRef(mockRef);
    setTtlLeft(provisioner.ttlSeconds);
    setState('cached');
  };

  const reset = () => {
    setState('idle');
    setTtlLeft(0);
    setRef('');
  };

  const fmtTtl = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Just-in-Time Credential Provisioning</h2>
        <p className="text-sm text-gray-500">
          <code className="text-xs bg-gray-100 px-1 rounded">DynamicCredentialStore</code> from{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">@datacules/agent-identity-store-dynamic</code> eliminates
          static long-lived secrets. Credentials don&apos;t exist until{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">resolve()</code> is called \u2014 a{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CredentialProvisioner</code> mints a short-lived secret
          on demand, caches it for its TTL, and lets the upstream system revoke it automatically when the TTL expires.
        </p>
      </div>

      {/* Provisioner selector */}
      <div className="flex gap-2 flex-wrap">
        {PROVISIONERS.map((p) => (
          <button
            key={p.id}
            onClick={() => { setActiveId(p.id); reset(); }}
            className={`px-3 py-1.5 rounded-md text-xs border font-medium transition-colors ${
              activeId === p.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Provisioner info */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 mb-1 font-mono">{provisioner.label}</div>
        <p className="text-sm text-gray-600">{provisioner.description}</p>
        <div className="mt-2 text-xs text-gray-400">TTL: {fmtTtl(provisioner.ttlSeconds)}</div>
      </div>

      {/* Provision simulator */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Provisioner simulator</div>
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          {state === 'idle' && (
            <div>
              <p className="text-sm text-gray-500 mb-3">No credential in cache \u2014 next resolve() will call the provisioner.</p>
              <button onClick={provision} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors">
                Call provision()
              </button>
            </div>
          )}
          {state === 'provisioning' && (
            <p className="text-sm text-gray-500 animate-pulse">Calling {provisioner.label}\u2026 minting credential</p>
          )}
          {state === 'cached' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">Cached</span>
                <span className="text-xs text-gray-500">TTL remaining: {fmtTtl(ttlLeft)}</span>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Provisioned ref</div>
                <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">{ref}</code>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${(ttlLeft / provisioner.ttlSeconds) * 100}%` }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={provision} className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors">
                  Force re-provision
                </button>
                <button onClick={reset} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                  Reset
                </button>
              </div>
            </div>
          )}
          {state === 'expired' && (
            <div className="space-y-3">
              <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">Expired \u2014 upstream revoked</span>
              <p className="text-sm text-gray-500">The provisioner will mint a fresh credential on the next resolve() call.</p>
              <button onClick={reset} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">Reset</button>
            </div>
          )}
        </div>
      </div>

      {/* Code snippet */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Integration \u2014 {provisioner.name}</div>
        <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed">
          <code>{provisioner.configLines.join('\n')}</code>
        </pre>
      </div>

      {/* How it works */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">How it works</div>
        <ol className="space-y-1.5 text-sm text-gray-600 list-decimal list-inside">
          <li>resolve() calls DynamicCredentialStore.findByRef(ref)</li>
          <li>Store checks in-memory cache \u2014 returns hit if unexpired</li>
          <li>On miss: provisioner.provision() calls the upstream system</li>
          <li>Fresh secret cached with provisionedAt + ttl metadata</li>
          <li>Secret ref returned to router; never stored statically</li>
          <li>Upstream system auto-revokes when TTL elapses</li>
        </ol>
      </div>
    </div>
  );
}
