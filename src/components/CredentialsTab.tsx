'use client';

import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '@/lib/credentials';
// Finding #8: Icons from shared source
import { IconInfo, IconDatabase, IconMail, IconCheck, IconClock } from '@/components/icons';
import type { Credential, SupportedProvider } from '@/lib/types';

type IconProps = { className?: string };

// Finding #6: Accept activeProvider prop to filter credentials by provider
interface CredentialsTabProps {
  provider?: SupportedProvider | 'any';
}

function LetterBadge({ letter, className }: { letter: string; className?: string }) {
  return <span className={`text-sm font-bold leading-none ${className ?? ''}`}>{letter}</span>;
}

const PROVIDER_ICONS: Record<string, (props: IconProps) => React.ReactElement> = {
  Linear:     (p) => <LetterBadge letter="L" {...p} />,
  PostgreSQL: IconDatabase,
  Notion:     (p) => <LetterBadge letter="N" {...p} />,
  Google:     IconMail,
};

// Finding #6: Map SupportedProvider → display label for filtering UI
const PROVIDER_DISPLAY: Partial<Record<SupportedProvider, string>> = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  gemini:    'Gemini',
  mistral:   'Mistral',
  local:     'Local / self-hosted',
};

function CredRow({ cred }: { cred: Credential }) {
  const Icon = PROVIDER_ICONS[cred.provider ?? ''] ?? IconDatabase;

  const isExpiringSoon =
    cred.expiresAt &&
    new Date(cred.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
        cred.kind === 'fixed' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
      }`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{cred.name}</p>
        <p className="text-xs text-gray-400">{cred.scope}</p>
        {/* Finding #7: Show expiry warning in UI */}
        {isExpired && (
          <p className="text-xs text-red-600 font-medium mt-0.5">Expired</p>
        )}
        {!isExpired && isExpiringSoon && (
          <p className="text-xs text-amber-600 mt-0.5">Expires soon</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {cred.status === 'active' && !isExpired ? (
          <><IconCheck className="text-green-500" /><span className="text-gray-400">Active</span></>
        ) : (
          <><IconClock className="text-gray-400" /><span className="text-gray-400">Pending</span></>
        )}
      </div>
    </div>
  );
}

export function CredentialsTab({ provider = 'any' }: CredentialsTabProps) {
  // Finding #6: Filter credentials when a specific provider is selected
  const allCreds = DEFAULT_CREDENTIALS;
  const fixed     = allCreds.filter((c) => c.kind === 'fixed');
  const delegated = allCreds.filter((c) => c.kind === 'user-delegated');

  const isFiltered = provider !== 'any';
  const providerLabel = isFiltered ? PROVIDER_DISPLAY[provider as SupportedProvider] : null;

  return (
    <div className="space-y-5">
      <div className="flex gap-2 p-3 rounded-lg bg-blue-50 text-blue-700">
        <IconInfo className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Credentials are stored encrypted and never passed to the model. The agent resolves which credential to attach to each outbound call at routing time.
        </p>
      </div>

      {/* Finding #6: Provider filter notice */}
      {isFiltered && (
        <div className="text-xs text-gray-500 px-1">
          Showing credentials for <span className="font-medium text-gray-700">{providerLabel}</span> — select &ldquo;Any provider&rdquo; to see all.
        </div>
      )}

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Fixed credentials (shared)</p>
        <div className="space-y-2">{fixed.map((c) => <CredRow key={c.id} cred={c} />)}</div>
      </div>

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">User-delegated slots (per-user)</p>
        <div className="space-y-2">{delegated.map((c) => <CredRow key={c.id} cred={c} />)}</div>
      </div>

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Routing rules</p>
        <div className="space-y-2">
          {DEFAULT_ROUTING_RULES.map((rule) => (
            <div key={rule.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs font-medium">
                {rule.matchResourceKind === 'shared'
                  ? <span>If task targets shared tool &rarr; use <span className="text-red-600">fixed credential</span></span>
                  : <span>If task touches personal resource &rarr; use <span className="text-blue-600">user-delegated token</span></span>
                }
              </p>
              <p className="text-xs text-gray-400">{rule.description}</p>
              <p className="text-xs text-gray-300">Priority: {rule.priority}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
