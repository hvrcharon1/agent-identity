'use client';

import { useState } from 'react';
import { AUTH_PATTERNS } from '@/lib/patterns';
import { FlowDiagram } from './FlowDiagram';
import type { AuthPatternType } from '@/lib/types';

type IconProps = { className?: string };

function IconUserCheck({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>
    </svg>
  );
}
function IconLock({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}
function IconArrows({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>
    </svg>
  );
}
function IconKey({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>
    </svg>
  );
}

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
