'use client';

import { useState } from 'react';
import { computeDecision } from '@/lib/decision';
import type { DecisionAnswers } from '@/lib/types';

const QUESTIONS: {
  key: keyof DecisionAnswers;
  text: string;
  yes: string;
  no: string;
}[] = [
  {
    key: 'variableAccess',
    text: 'Do different users need different levels of access to the same resource?',
    yes: 'Yes — user A can see more than user B',
    no: 'No — all users have identical access',
  },
  {
    key: 'mixedResources',
    text: 'Does the agent access both shared (all-user) and personal (per-user) resources?',
    yes: 'Yes — both kinds in the same agent',
    no: 'No — only one kind',
  },
  {
    key: 'auditRequired',
    text: 'How important is a per-user audit trail?',
    yes: 'Critical — we need to know which user caused each action',
    no: 'Not needed — agent-level logging is enough',
  },
];

export function DecisionTab() {
  const [answers, setAnswers] = useState<DecisionAnswers>({
    variableAccess: null,
    mixedResources: null,
    auditRequired: null,
  });

  const result = computeDecision(answers);

  function pick(key: keyof DecisionAnswers, value: boolean) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Answer three questions and the helper tells you which pattern to use and why it matters.
      </p>

      {QUESTIONS.map(({ key, text, yes, no }) => (
        <div key={key} className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium mb-3">{text}</p>
          <div className="space-y-2">
            {([true, false] as const).map((value) => {
              const label = value ? yes : no;
              const isPicked = answers[key] === value;
              return (
                <button
                  key={String(value)}
                  onClick={() => pick(key, value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-all ${
                    isPicked
                      ? 'border-brand-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      isPicked ? 'border-brand-600' : 'border-gray-300'
                    }`}
                  >
                    {isPicked && <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />}
                  </div>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-blue-900 mb-1">✦ {result.label}</p>
          <p className="text-xs text-blue-700 leading-relaxed">{result.explanation}</p>
        </div>
      )}
    </div>
  );
}
