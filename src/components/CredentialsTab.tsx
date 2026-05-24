'use client';

import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '@/lib/credentials';
import type { Credential } from '@/lib/types';

type IconProps = { className?: string };

function IconInfo({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
  );
}
function IconDatabase({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>
    </svg>
  );
}
function IconMail({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}
function IconCheck({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  );
}
function IconClock({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
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

function CredRow({ cred }: { cred: Credential }) {
  const Icon = PROVIDER_ICONS[cred.provider ?? ''] ?? IconDatabase;
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
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {cred.status === 'active' ? (
          <><IconCheck className="text-green-500" /><span className="text-gray-400">Active</span></>
        ) : (
          <><IconClock className="text-gray-400" /><span className="text-gray-400">Pending</span></>
        )}
      </div>
    </div>
  );
}

export function CredentialsTab() {
  const fixed     = DEFAULT_CREDENTIALS.filter((c) => c.kind === 'fixed');
  const delegated = DEFAULT_CREDENTIALS.filter((c) => c.kind === 'user-delegated');

  return (
    <div className="space-y-5">
      <div className="flex gap-2 p-3 rounded-lg bg-blue-50 text-blue-700">
        <IconInfo className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Credentials are stored encrypted and never passed to the model. The agent resolves which credential to attach to each outbound call at routing time.
        </p>
      </div>

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
                {rule.resourceKind === 'shared'
                  ? <span>If task targets shared tool &rarr; use <span className="text-red-600">fixed credential</span></span>
                  : <span>If task touches personal resource &rarr; use <span className="text-blue-600">user-delegated token</span></span>
                }
              </p>
              <p className="text-xs text-gray-400">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
