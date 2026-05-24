'use client';

import { useState } from 'react';
import { UserCheck, Lock, ArrowLeftRight, Key } from 'lucide-react';
import { AUTH_PATTERNS } from '@/lib/patterns';
import { FlowDiagram } from './FlowDiagram';
import type { AuthPatternType } from '@/lib/types';

const ICONS: Record<AuthPatternType, React.FC<{ className?: string }>> = {
  'individual-user-auth': UserCheck,
  'fixed-credential': Lock,
  'context-switched': ArrowLeftRight,
  'token-exchange': Key,
};

const ICON_BG: Record<AuthPatternType, string> = {
  'individual-user-auth': 'bg-blue-50',
  'fixed-credential': 'bg-red-50',
  'context-switched': 'bg-amber-50',
  'token-exchange': 'bg-green-50',
};

const ICON_COLOR: Record<AuthPatternType, string> = {
  'individual-user-auth': 'text-blue-600',
  'fixed-credential': 'text-red-600',
  'context-switched': 'text-amber-600',
  'token-exchange': 'text-green-600',
};

export function PatternsTab() {
  const [selected, setSelected] = useState<AuthPatternType>('individual-user-auth');
  const active = AUTH_PATTERNS.find((p) => p.id === selected)!;

  return (
    <div className="space-y-3">
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
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  pattern.recommended
                    ? 'bg-blue-50 text-blue-700 border-transparent'
                    : 'border-gray-200 text-gray-500'
                }`}
              >
                {pattern.badgeLabel}
              </span>
            </div>
          </button>
        );
      })}

      <FlowDiagram label={`Flow — ${active.name.toLowerCase()}`} nodes={active.flowNodes} />
    </div>
  );
}
