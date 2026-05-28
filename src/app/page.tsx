'use client';

import { useState } from 'react';
import { IdentitiesTab } from '@/components/IdentitiesTab';
import { PatternsTab } from '@/components/PatternsTab';
import { CredentialsTab } from '@/components/CredentialsTab';
import { DecisionTab } from '@/components/DecisionTab';
import { MigrationTab } from '@/components/MigrationTab';
import { AttestationTab } from '@/components/AttestationTab';
import { CanaryTab } from '@/components/CanaryTab';
import { ApprovalTab } from '@/components/ApprovalTab';
import { BudgetTab } from '@/components/BudgetTab';
import { FederationTab } from '@/components/FederationTab';
import { AnomalyTab } from '@/components/AnomalyTab';
import type { SupportedProvider } from '@/lib/types';

// ─── Inline SVG tab icons ────────────────────────────────────────────
function IconShield({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}
function IconKey({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>
    </svg>
  );
}
function IconGitBranch({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
}
function IconHelpCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}
function IconCpu({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  );
}
function IconArrowLeftRight({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>
    </svg>
  );
}
function IconFingerprint({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
      <path d="M5 19.5C5.5 18 6 15 6 12c0-1.7.7-3.3 1.8-4.5"/>
      <path d="M17.5 5.5C19 7 20 9.4 20 12c0 4.4-.7 7.4-1.5 9"/>
      <path d="M10 12a2 2 0 0 1 4 0c0 1.9-.8 3.8-2 5"/>
      <path d="M9 12a3 3 0 0 1 6 0c0 2.8-1.2 5.3-3 7"/>
    </svg>
  );
}
function IconZap({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  );
}
function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  );
}
function IconGauge({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>
    </svg>
  );
}
function IconNetwork({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/>
      <rect x="9" y="2" width="6" height="6" rx="1"/>
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>
    </svg>
  );
}
function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

const TABS = [
  { id: 'identities',   label: 'Identity types',    Icon: IconShield        },
  { id: 'patterns',     label: 'Auth patterns',      Icon: IconGitBranch     },
  { id: 'credentials',  label: 'Credentials',        Icon: IconKey           },
  { id: 'decide',       label: 'Decision helper',    Icon: IconHelpCircle    },
  { id: 'migration',    label: 'Data migration',     Icon: IconArrowLeftRight },
  { id: 'attestation',  label: 'Attestation',        Icon: IconFingerprint   },
  { id: 'canary',       label: 'Canary routing',     Icon: IconZap           },
  { id: 'approval',     label: 'Approvals',          Icon: IconCheckCircle   },
  { id: 'budget',       label: 'Budgets',            Icon: IconGauge         },
  { id: 'federation',   label: 'Federation',         Icon: IconNetwork       },
  { id: 'anomaly',      label: 'Anomaly detection',  Icon: IconAlertTriangle },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PROVIDERS: { id: SupportedProvider; label: string }[] = [
  { id: 'openai',    label: 'OpenAI'              },
  { id: 'anthropic', label: 'Anthropic'           },
  { id: 'gemini',    label: 'Gemini'              },
  { id: 'mistral',   label: 'Mistral'             },
  { id: 'local',     label: 'Local / self-hosted'  },
];

export default function Home() {
  const [activeTab, setActiveTab]           = useState<TabId>('identities');
  const [activeProvider, setActiveProvider] = useState<SupportedProvider | 'any'>('any');

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
              <IconCpu className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Agent identity &amp; auth</h1>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            Define who your agent acts as, with which credentials, and when — across any AI provider or model.
          </p>
        </div>

        {/* Provider strip */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Compatible providers</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveProvider('any')}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                activeProvider === 'any'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              Any provider
            </button>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProvider(p.id)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  activeProvider === p.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Main navigation">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  activeTab === id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'identities'  && <IdentitiesTab />}
        {activeTab === 'patterns'    && <PatternsTab provider={activeProvider} />}
        {activeTab === 'credentials' && <CredentialsTab provider={activeProvider} />}
        {activeTab === 'decide'      && <DecisionTab />}
        {activeTab === 'migration'   && <MigrationTab />}
        {activeTab === 'attestation' && <AttestationTab />}
        {activeTab === 'canary'      && <CanaryTab />}
        {activeTab === 'approval'    && <ApprovalTab />}
        {activeTab === 'budget'      && <BudgetTab />}
        {activeTab === 'federation'  && <FederationTab />}
        {activeTab === 'anomaly'     && <AnomalyTab />}

      </div>
    </main>
  );
}
