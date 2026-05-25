'use client';

import { useState } from 'react';
import type { MigrationPhase } from '@/lib/types';

// ─── Phase timeline data ──────────────────────────────────────────────────────

interface PhaseInfo {
  id: MigrationPhase;
  label: string;
  credential: 'source-read' | 'target-write' | 'none' | 'both';
  description: string;
  warning?: string;
}

const PHASES: PhaseInfo[] = [
  {
    id: 'dry-run',
    label: 'Dry run',
    credential: 'source-read',
    description: 'Read from source only. No writes anywhere. Use a read-only source credential.',
    warning: 'Routing rule must set readOnly: true to enforce this at the router level.',
  },
  {
    id: 'extract',
    label: 'Extract',
    credential: 'source-read',
    description: 'Pull data from the source system. Read-only source credential required.',
  },
  {
    id: 'transform',
    label: 'Transform',
    credential: 'none',
    description: 'In-memory reshaping — no credential needed. Data never touches either system.',
  },
  {
    id: 'load',
    label: 'Load',
    credential: 'target-write',
    description: 'Write transformed data to target system. Write-scoped target credential required.',
    warning: 'Use reserve() before the batch loop to prevent concurrent migrations corrupting the target.',
  },
  {
    id: 'verify',
    label: 'Verify',
    credential: 'both',
    description: 'Read from both source and target to confirm row counts / checksums match.',
  },
  {
    id: 'rollback',
    label: 'Rollback',
    credential: 'target-write',
    description: 'Undo writes on the target. Same write credential as load phase.',
    warning: 'Only triggered when verify fails or an explicit rollback is requested.',
  },
];

// ─── Credential badge colours ─────────────────────────────────────────────────

const CRED_BADGE: Record<PhaseInfo['credential'], { label: string; className: string }> = {
  'source-read':  { label: 'Source (read)',        className: 'bg-blue-100 text-blue-700 border-blue-200' },
  'target-write': { label: 'Target (write)',        className: 'bg-amber-100 text-amber-700 border-amber-200' },
  'both':         { label: 'Source + Target',       className: 'bg-purple-100 text-purple-700 border-purple-200' },
  'none':         { label: 'No credential',         className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// ─── Migration Q&A helper ─────────────────────────────────────────────────────

interface MigrationAnswers {
  crossProvider: boolean | null;   // source and target on different AI providers?
  sameCredential: boolean | null;  // same credential ref for source and target?
  longRunning: boolean | null;     // expected to run > 30 minutes?
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MigrationTab() {
  const [activePhase, setActivePhase] = useState<MigrationPhase | null>(null);
  const [answers, setAnswers] = useState<MigrationAnswers>({
    crossProvider: null,
    sameCredential: null,
    longRunning: null,
  });

  const phaseDetail = PHASES.find((p) => p.id === activePhase);

  function pick(key: keyof MigrationAnswers, value: boolean) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  // Derive warnings from answers
  const warnings: string[] = [];
  if (answers.crossProvider === true) {
    warnings.push(
      'Cross-provider migration: the agent will need a token exchange mid-migration. ' +
        'Set up a token-exchange routing rule so the load-phase credential is in the target provider\'s format.'
    );
  }
  if (answers.sameCredential === true) {
    warnings.push(
      'Same credential for source and target: this is a common misconfiguration. ' +
        'The extract phase requires a source-scoped read credential; the load phase requires a target-scoped write credential. ' +
        'Use separate credential refs (e.g. "source-readonly-slot" and "target-write-slot").'
    );
  }
  if (answers.longRunning === true) {
    warnings.push(
      'Long-running migration (>30 min): call reserve() on both credentials before the batch loop begins. ' +
        'Check expiresAt from POST /api/migrate/resolve and refresh before the window closes. ' +
        'Always call release() in a finally block.'
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 leading-relaxed">
        A guide to configuring agent credentials for data migration workflows — covering
        which credential is active at each phase, how to prevent concurrent migrations
        corrupting the target, and when a token exchange is needed.
      </p>

      {/* ── Flow diagram ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">System flow</p>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source */}
            <div className="flex flex-col items-center">
              <div className="w-28 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-center">
                <p className="text-xs font-semibold text-blue-700">Source system</p>
                <p className="text-[10px] text-blue-500 mt-0.5">e.g. Postgres, S3</p>
              </div>
              <p className="text-[10px] text-blue-600 mt-1">source-read cred</p>
            </div>

            {/* Arrow */}
            <svg width="32" height="16" viewBox="0 0 32 16" fill="none" aria-hidden="true">
              <path d="M0 8h28M22 2l8 6-8 6" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>

            {/* Agent */}
            <div className="flex flex-col items-center">
              <div className="w-32 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-center">
                <p className="text-xs font-semibold text-white">Agent</p>
                <p className="text-[10px] text-gray-400 mt-0.5">holds both creds</p>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">POST /api/migrate/resolve</p>
            </div>

            {/* Arrow */}
            <svg width="32" height="16" viewBox="0 0 32 16" fill="none" aria-hidden="true">
              <path d="M0 8h28M22 2l8 6-8 6" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>

            {/* Target */}
            <div className="flex flex-col items-center">
              <div className="w-28 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center">
                <p className="text-xs font-semibold text-amber-700">Target system</p>
                <p className="text-[10px] text-amber-500 mt-0.5">e.g. new DB, bucket</p>
              </div>
              <p className="text-[10px] text-amber-600 mt-1">target-write cred</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Phase timeline ─────────────────────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">
          Phase timeline — click a phase to see details
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {PHASES.map((phase, i) => (
            <button
              key={phase.id}
              onClick={() => setActivePhase(activePhase === phase.id ? null : phase.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-all ${
                activePhase === phase.id
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              <span className="text-[10px] font-mono text-gray-400">{i + 1}</span>
              {phase.label}
            </button>
          ))}
        </div>

        {phaseDetail && (
          <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold capitalize">{phaseDetail.label} phase</p>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                  CRED_BADGE[phaseDetail.credential].className
                }`}
              >
                {CRED_BADGE[phaseDetail.credential].label}
              </span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">{phaseDetail.description}</p>
            {phaseDetail.warning && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-700 leading-relaxed">⚠ {phaseDetail.warning}</p>
              </div>
            )}
            {/* Example routing rule */}
            <details className="group">
              <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                Example routing rule for this phase
              </summary>
              <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700 leading-relaxed">{exampleRule(phaseDetail)}</pre>
            </details>
          </div>
        )}
      </div>

      {/* ── Migration configuration Q&A ───────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">
          Configuration check
        </p>
        <div className="space-y-3">
          {MIGRATION_QUESTIONS.map(({ key, text, yes, no }) => (
            <div key={key} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-medium mb-2.5">{text}</p>
              <div className="flex gap-2">
                {([true, false] as const).map((value) => {
                  const label = value ? yes : no;
                  const isPicked = answers[key] === value;
                  return (
                    <button
                      key={String(value)}
                      onClick={() => pick(key, value)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs transition-all ${
                        isPicked
                          ? 'border-brand-600 bg-blue-50 text-blue-700 font-medium'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Warnings from answers ─────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-800 leading-relaxed">⚠ {w}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── API reference card ────────────────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-700">Migration API — quick reference</p>
        <div className="space-y-1.5 text-[11px] text-gray-500 font-mono">
          <p><span className="text-green-600">POST</span> /api/migrate/resolve — resolve source + target credentials for a phase</p>
          <p><span className="text-blue-600">store</span>.reserve(ref, migrationId, ttl) — lock credential before batch loop</p>
          <p><span className="text-blue-600">store</span>.release(ref, migrationId) — always call in finally block</p>
          <p><span className="text-purple-600">router</span>.resolvePair(ctx: MigrationContext) — resolve both creds at once</p>
          <p><span className="text-amber-600">adapter</span>.validateForMigration(cred, phase) — catch scope mismatches early</p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIGRATION_QUESTIONS: {
  key: keyof MigrationAnswers;
  text: string;
  yes: string;
  no: string;
}[] = [
  {
    key: 'crossProvider',
    text: 'Are the source and target systems on different AI providers?',
    yes: 'Yes — e.g. OpenAI → Anthropic',
    no: 'No — same provider',
  },
  {
    key: 'sameCredential',
    text: 'Are you planning to use the same credential ref for source and target?',
    yes: 'Yes — one credential for both',
    no: 'No — separate credentials',
  },
  {
    key: 'longRunning',
    text: 'Could the migration take longer than 30 minutes?',
    yes: 'Yes — large dataset',
    no: 'No — small / fast migration',
  },
];

function exampleRule(phase: PhaseInfo): string {
  const credRef =
    phase.credential === 'target-write'
      ? 'target-write-slot'
      : phase.credential === 'none'
      ? '(no credential needed)'
      : 'source-readonly-slot';

  if (phase.credential === 'none') {
    return '// transform phase runs in-memory — no routing rule needed';
  }

  return `{
  id: "migration-${phase.id}",
  description: "${phase.label} phase credential",
  matchPhase: "${phase.id}",${phase.credential === 'source-read' || phase.id === 'dry-run' ? '\n  readOnly: true,' : ''}
  credentialRef: "${credRef}",
  credentialKind: "${phase.credential === 'target-write' ? 'fixed' : 'fixed'}",
  priority: 60,
}`;
}
