'use client';

import { useState } from 'react';
import { FlowDiagram } from './FlowDiagram';
import type { IdentityType, FlowNode } from '@/lib/types';

// Inline SVG icon components — no lucide-react dependency needed at runtime
function IconUserCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>
    </svg>
  );
}
function IconLock({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}
function IconArrows({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>
    </svg>
  );
}
function IconBot({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
    </svg>
  );
}
function IconInfo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
  );
}

interface IdentityDef {
  type: IdentityType;
  name: string;
  kind: string;
  description: string;
  useTags: string[];
  avoidTags: string[];
  Icon: ({ className }: { className?: string }) => JSX.Element;
  iconBg: string;
  iconColor: string;
  flowLabel: string;
  flowNodes: FlowNode[];
  alert: string;
}

const IDENTITIES: IdentityDef[] = [
  {
    type: 'user-delegated',
    name: 'User-delegated',
    kind: 'Per-user auth',
    description:
      "Agent authenticates as the individual user. Each user's tokens, OAuth grants, or API keys are scoped to their own account.",
    useTags: ['Variable access', 'Audit trail'],
    avoidTags: ['More setup'],
    Icon: IconUserCheck,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    flowLabel: 'Auth flow — user-delegated',
    flowNodes: [
      { label: 'User N', sublabel: 'initiates', variant: 'blue' },
      { label: 'User N Auth', sublabel: 'individual token', variant: 'blue' },
      { label: 'Agent', sublabel: 'routes cred', variant: 'default' },
      { label: 'Auth check', sublabel: 'per-user ACL', variant: 'default' },
      { label: 'Resource', sublabel: "user's scope", variant: 'green' },
    ],
    alert:
      "User-delegated auth is best when users have different permissions — each user sees only what they're entitled to.",
  },
  {
    type: 'fixed-service',
    name: 'Fixed service',
    kind: 'Shared credential',
    description:
      'Agent uses a single service account or API key. All users share identical access permissions via the agent.',
    useTags: ['Simple setup'],
    avoidTags: ['Uniform access', 'Less traceability'],
    Icon: IconLock,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    flowLabel: 'Auth flow — fixed service account',
    flowNodes: [
      { label: 'Any user', sublabel: 'any identity', variant: 'default' },
      { label: 'Agent', sublabel: 'single cred', variant: 'default' },
      { label: 'Fixed Auth', sublabel: 'shared key', variant: 'red' },
      { label: 'Shared tool', sublabel: 'same access all', variant: 'green' },
    ],
    alert:
      'Fixed credentials are ideal for tools where all users are equal — e.g. a shared task board or internal wiki.',
  },
  {
    type: 'hybrid',
    name: 'Hybrid',
    kind: 'Context-switched',
    description:
      "Agent holds both fixed and user-delegated credentials. It selects which to present based on the task — service account for shared resources, user token for personal data.",
    useTags: ['Precise', 'Flexible'],
    avoidTags: ['Complex'],
    Icon: IconArrows,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    flowLabel: 'Auth flow — hybrid (context-switched)',
    flowNodes: [
      { label: 'User N', sublabel: 'initiates', variant: 'blue' },
      { label: 'Agent', sublabel: 'inspects task', variant: 'amber' },
      { label: 'Route decision', sublabel: 'fixed or delegated?', variant: 'amber' },
      { label: 'Correct cred', sublabel: 'right tool, right key', variant: 'green' },
    ],
    alert:
      'Hybrid is the most precise pattern — the agent explicitly decides which credential to use per task.',
  },
  {
    type: 'agent-as-service',
    name: 'Agent-as-service',
    kind: 'Machine identity',
    description:
      'The agent has its own first-class identity — not a user proxy, not a service account. Used in agent-to-agent or multi-agent pipelines.',
    useTags: ['Agent pipelines', 'Non-human flows'],
    avoidTags: ['Niche use'],
    Icon: IconBot,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    flowLabel: 'Auth flow — agent-as-service (machine identity)',
    flowNodes: [
      { label: 'Upstream agent', sublabel: 'caller', variant: 'default' },
      { label: 'Agent identity', sublabel: 'own principal', variant: 'green' },
      { label: 'Agent-to-agent auth', sublabel: 'machine token', variant: 'green' },
      { label: 'Downstream agent', sublabel: 'or API', variant: 'default' },
    ],
    alert:
      'Agent-as-service identity is used in multi-agent pipelines where no human is the direct principal.',
  },
];

export function IdentitiesTab() {
  const [selected, setSelected] = useState<IdentityType>('user-delegated');
  const active = IDENTITIES.find((i) => i.type === selected)!;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        An agent can carry different identity contexts depending on who it acts for. Pick an identity type to understand when to use it.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {IDENTITIES.map((id) => {
          const { Icon } = id;
          const isSelected = selected === id.type;
          return (
            <button
              key={id.type}
              onClick={() => setSelected(id.type)}
              className={`text-left bg-white border rounded-xl p-4 transition-all ${
                isSelected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${id.iconBg}`}>
                  <Icon className={`w-4 h-4 ${id.iconColor}`} />
                </div>
                <div>
                  <p className="text-sm font-medium">{id.name}</p>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{id.kind}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mb-2.5">{id.description}</p>
              <div className="flex flex-wrap gap-1">
                {id.useTags.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700">{t}</span>
                ))}
                {id.avoidTags.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700">{t}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <FlowDiagram label={active.flowLabel} nodes={active.flowNodes} />

      <div className="flex gap-2 p-3 rounded-lg bg-blue-50 text-blue-700">
        <IconInfo className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">{active.alert}</p>
      </div>
    </div>
  );
}
