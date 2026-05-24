'use client';

import { useState } from 'react';
import { Shield, Key, GitBranch, HelpCircle, Cpu } from 'lucide-react';
import { IdentitiesTab } from '@/components/IdentitiesTab';
import { PatternsTab } from '@/components/PatternsTab';
import { CredentialsTab } from '@/components/CredentialsTab';
import { DecisionTab } from '@/components/DecisionTab';
import type { SupportedProvider } from '@/lib/types';

const TABS = [
  { id: 'identities', label: 'Identity types', icon: Shield },
  { id: 'patterns', label: 'Auth patterns', icon: GitBranch },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'decide', label: 'Decision helper', icon: HelpCircle },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PROVIDERS: { id: SupportedProvider; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'local', label: 'Local / self-hosted' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('identities');
  const [activeProvider, setActiveProvider] = useState<SupportedProvider | 'any'>('any');

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
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
          <nav className="flex gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
        {activeTab === 'identities' && <IdentitiesTab />}
        {activeTab === 'patterns' && <PatternsTab />}
        {activeTab === 'credentials' && <CredentialsTab />}
        {activeTab === 'decide' && <DecisionTab />}
      </div>
    </main>
  );
}
