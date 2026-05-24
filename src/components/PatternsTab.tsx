'use client';

import { useState } from 'react';
import { AUTH_PATTERNS } from '@/lib/patterns';
import { FlowDiagram } from './FlowDiagram';
// Finding #8: Icons imported from shared source
import { IconUserCheck, IconLock, IconArrows, IconKey } from '@/components/icons';
import type { AuthPatternType, SupportedProvider } from '@/lib/types';

type IconProps = { className?: string };

// Finding #6: Accept activeProvider prop
interface PatternsTabProps {
  provider?: SupportedProvider | 'any';
}

// Finding #6: Per-provider injection notes shown when a provider is selected
const PROVIDER_NOTES: Partial<Record<SupportedProvider, string>> = {
  openai:    'Inject via Authorization: Bearer header (server-side) + user field in request body for per-user audit.',
  anthropic: 'Inject via x-api-key header (server-side) + metadata.user_id field for per-user audit trail.',
  gemini:    'Inject via x-goog-api-key header (server-side). Use labels.user_id in the request body for user tracking.',
  mistral:   'Inject via Authorization: Bearer header (server-side). Log resolvedFor server-side against the request ID.',
  local:     'Auth mechanism varies by runtime (Ollama, vLLM, LM Studio). Use network-level controls and server-side logging.',
};

const ICONS: Record<AuthPatternType, (props: IconProps) => React.ReactElement> = {
  'individual-user-auth': IconUserCheck,
  'fixed-credential':     IconLock,
  'context-switched':     IconArrows,
  'token-exchange':       IconKey,
};

const ICON_BG: Record<AuthPatternType, string> = {
  'individual-user-auth': 'bg-blue-50',
  'fixed-credential':     'bg-red-50',
  'context-switched':     'bg-amber-50',
  'token-exchange':       'bg-green-50',
};

const ICON_COLOR: Record<AuthPatternType, string> = {
  'individual-user-auth': 'text-blue-600',
  'fixed-credential':     'text-red-600',
  'context-switched':     'text-amber-600',
  'token-exchange':       'text-green-600',
};

export function PatternsTab({ provider = 'any' }: PatternsTabProps) {
  const [selected, setSelected] = useState<AuthPatternType>('individual-user-auth');
  const active = AUTH_PATTERNS.find((p) => p.id === selected)!;

  const providerNote = provider !== 'any' ? PROVIDER_NOTES[provider] : null;

  return (
    <div className="space-y-3">
      {/* Finding #6: Show provider-specific injection note when a provider is selected */}
      {providerNote && (
        <div className="flex gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
          <span className="text-xs font-semibold uppercase tracking-wide flex-shrink-0 mt-0.5">
            {provider?.toUpperCase()}
          </span>
          <p className="text-xs leading-relaxed">{providerNote}</p>
        </div>
      )}

      {AUTH_PATTERNS.map((pattern) => {
        const Icon = ICONS[pattern.id];
        const isSelected = selected === pattern.id;
        return (
          <button
            key={pattern.id}
            onClick={() => setSelected(pattern.id)}
            className={`w-full text-left flex items-start gap-3 bg-white border rounded-xl p-4 transition-all ${
              isSelected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ICON_BG[pattern.id]}`}>
              <Icon className={`w-4 h-4 ${ICON_COLOR[pattern.id]}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-0.5">{pattern.name}</p>
              <p className="text-xs text-gray-500 leading-relaxed mb-2">{pattern.description}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                pattern.recommended ? 'bg-blue-50 text-blue-700 border-transparent' : 'border-gray-200 text-gray-500'
              }`}>
                {pattern.badgeLabel}
              </span>
            </div>
          </button>
        );
      })}
      <FlowDiagram label={`Flow - ${active.name.toLowerCase()}`} nodes={active.flowNodes} />
    </div>
  );
}
