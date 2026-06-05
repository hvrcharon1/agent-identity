/**
 * Decision helper — recommends an auth pattern based on user answers.
 *
 * Fixes applied (synced from packages/core/src/decision.ts):
 *   1. Q4 null-guard moved inside the variableAccess && !mixedResources branch —
 *      context-switched no longer gates on an unused Q4 answer.
 *   2. Q3 (auditRequired) is now consulted on ALL fixed-access paths, including
 *      the !variableAccess && mixedResources case. Previously Q3 was silently
 *      ignored there, producing the same result regardless of audit requirement.
 *   3. New distinct result label: 'resource-type awareness + request tagging'
 *      for !variableAccess && mixedResources && auditRequired.
 *   4. DECISION_QUESTIONS exported here so the question set can be tested
 *      independently of React and imported by the UI component.
 *   5. Q3 showIf: variableAccess === false — question is hidden and never asked
 *      on variable-access paths where it has no effect.
 *   6. Q4 showIf: variableAccess === true && mixedResources === false —
 *      context-switched path (variable + mixed) no longer surfaces Q4.
 */
import type { DecisionAnswers, DecisionResult, AuthPatternType } from './types';

// ─── Question registry ────────────────────────────────────────────────────────

export interface DecisionQuestion {
  key: keyof DecisionAnswers;
  text: string;
  yes: string;
  no: string;
  /**
   * When present, the question is only shown (and therefore only required)
   * when the predicate returns true. Hidden questions do NOT gate the result.
   */
  showIf?: (a: DecisionAnswers) => boolean;
}

export const DECISION_QUESTIONS: DecisionQuestion[] = [
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
    text: 'Do you need a per-user audit trail?',
    yes: 'Yes — we need to know which user caused each action',
    no: 'No — agent-level logging is enough',
    showIf: (a) => a.variableAccess === false,
  },
  {
    key: 'longTermTokenStorage',
    text: 'Can you store per-user tokens long-term (e.g. in an encrypted DB)?',
    yes: 'Yes — we can persist user tokens securely',
    no: 'No — tokens must be obtained at request time only',
    showIf: (a) => a.variableAccess === true && a.mixedResources === false,
  },
];

// ─── Decision engine ──────────────────────────────────────────────────────────

function make(pattern: AuthPatternType, label: string, explanation: string): DecisionResult {
  return { pattern, label, explanation };
}

export function computeDecision(answers: DecisionAnswers): DecisionResult | null {
  const { variableAccess, mixedResources, auditRequired, longTermTokenStorage } = answers;

  if (variableAccess === null || mixedResources === null) return null;

  // ── Variable-access paths ─────────────────────────────────────────────────

  if (variableAccess) {
    if (mixedResources) {
      return make(
        'context-switched',
        'Hybrid (context-switched)',
        'Your agent needs both fixed credentials for shared resources and user-delegated tokens for personal data. Set explicit routing rules so the agent always knows which to use.',
      );
    }
    if (longTermTokenStorage === null) return null;
    if (!longTermTokenStorage) {
      return make(
        'token-exchange',
        'Token exchange / impersonation',
        'You need per-user access but cannot store tokens long-term. Use OAuth token exchange or STS assume-role to get scoped user tokens at request time, without persisting them.',
      );
    }
    return make(
      'individual-user-auth',
      'Individual user auth',
      "Users have different access levels, so each request must carry that user's own token. The agent passes it through; the downstream resource enforces the ACL.",
    );
  }

  // ── Fixed-access paths (variableAccess = false) ───────────────────────────
  if (auditRequired === null) return null;

  if (mixedResources) {
    if (auditRequired) {
      return make(
        'fixed-credential',
        'Fixed credential — resource-type awareness + request tagging',
        "A single service account can access both resource types. Tag each request with the calling user's ID in your own audit log so you have a per-user trace even though the credential is shared.",
      );
    }
    return make(
      'fixed-credential',
      'Fixed credential with resource-type awareness',
      'All users are equal but the agent accesses different resource types. A single fixed credential works — ensure its scope covers both resource types your agent needs.',
    );
  }

  if (auditRequired) {
    return make(
      'fixed-credential',
      'Fixed credential + request tagging',
      "Use a shared service account, but tag each request with the calling user's ID in your own logs. Gives you the simplicity of a fixed credential with an audit trail layer above it.",
    );
  }
  return make(
    'fixed-credential',
    'Fixed credential',
    "All users are equal and audit trail isn't critical. A single service account keeps setup simple. Store the key encrypted; never pass it to the model layer.",
  );
}
