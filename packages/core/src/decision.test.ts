/**
 * decision.test.ts — Vitest tests for packages/core/src/decision.ts
 *
 * Ported from src/lib/decision.test.ts and expanded with:
 *   - context-switched resolves from Q1+Q2 only (regression guard for Bug #3)
 *   - !variableAccess && mixedResources && auditRequired distinct label (Bug #4)
 *   - DECISION_QUESTIONS showIf guard coverage
 */
import { describe, it, expect } from 'vitest';
import { computeDecision, DECISION_QUESTIONS } from './decision';
import type { DecisionAnswers } from './types';

function answers(overrides: Partial<DecisionAnswers>): DecisionAnswers {
  return {
    variableAccess: null,
    mixedResources: null,
    auditRequired: null,
    longTermTokenStorage: null,
    ...overrides,
  };
}

describe('computeDecision', () => {

  // ── Null gates ──────────────────────────────────────────────────────────────

  it('returns null when Q1 or Q2 is unanswered', () => {
    expect(computeDecision(answers({}))).toBeNull();
    expect(computeDecision(answers({ variableAccess: true }))).toBeNull();
    expect(computeDecision(answers({ mixedResources: false }))).toBeNull();
  });

  it('returns null when variableAccess=true, mixedResources=false and Q4 is unanswered', () => {
    expect(
      computeDecision(answers({ variableAccess: true, mixedResources: false, auditRequired: false }))
    ).toBeNull();
  });

  it('returns null when variableAccess=false and Q3 is unanswered', () => {
    expect(
      computeDecision(answers({ variableAccess: false, mixedResources: false }))
    ).toBeNull();
    expect(
      computeDecision(answers({ variableAccess: false, mixedResources: true }))
    ).toBeNull();
  });

  // ── context-switched ────────────────────────────────────────────────────────

  it('context-switched resolves immediately from Q1+Q2 — no Q3/Q4 gate (Bug #3 regression guard)', () => {
    // Q3 and Q4 are null — result must not be null
    const result = computeDecision(answers({ variableAccess: true, mixedResources: true }));
    expect(result?.pattern).toBe('context-switched');
  });

  it('context-switched result is identical regardless of Q3/Q4 values', () => {
    const withAll = computeDecision(answers({
      variableAccess: true, mixedResources: true, auditRequired: true, longTermTokenStorage: true,
    }));
    const withNone = computeDecision(answers({
      variableAccess: true, mixedResources: true, auditRequired: false, longTermTokenStorage: false,
    }));
    expect(withAll?.pattern).toBe('context-switched');
    expect(withNone?.pattern).toBe('context-switched');
    expect(withAll?.label).toBe(withNone?.label);
  });

  // ── token-exchange ──────────────────────────────────────────────────────────

  it('token-exchange: variableAccess=true, mixedResources=false, longTermTokenStorage=false', () => {
    const result = computeDecision(answers({
      variableAccess: true, mixedResources: false, auditRequired: false, longTermTokenStorage: false,
    }));
    expect(result?.pattern).toBe('token-exchange');
  });

  // ── individual-user-auth ────────────────────────────────────────────────────

  it('individual-user-auth: variableAccess=true, mixedResources=false, longTermTokenStorage=true', () => {
    const result = computeDecision(answers({
      variableAccess: true, mixedResources: false, auditRequired: true, longTermTokenStorage: true,
    }));
    expect(result?.pattern).toBe('individual-user-auth');
  });

  // ── fixed-credential (plain) ────────────────────────────────────────────────

  it('fixed-credential: !variableAccess, !mixedResources, !auditRequired', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: false, auditRequired: false,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toBe('Fixed credential');
  });

  // ── fixed-credential + request tagging ─────────────────────────────────────

  it('fixed-credential + request tagging: !variableAccess, !mixedResources, auditRequired=true', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: false, auditRequired: true,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('tagging');
    expect(result?.label).not.toContain('resource-type');
  });

  // ── fixed-credential + resource-type awareness ──────────────────────────────

  it('resource-type awareness only: !variableAccess, mixedResources=true, !auditRequired', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: true, auditRequired: false,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('resource-type awareness');
    expect(result?.label).not.toContain('tagging');
  });

  it('resource-type awareness + request tagging: !variableAccess, mixedResources=true, auditRequired=true (Bug #4 regression guard)', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: true, auditRequired: true,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('resource-type awareness');
    expect(result?.label).toContain('tagging');
  });

  // ── Q4 is not required for fixed-access paths ────────────────────────────────

  it('longTermTokenStorage=null does not block fixed-access results', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: false, auditRequired: true, longTermTokenStorage: null,
    }));
    // Q4 null should not block result on fixed-access path
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('fixed-credential');
  });

});

describe('DECISION_QUESTIONS', () => {

  it('exports exactly 4 questions', () => {
    expect(DECISION_QUESTIONS).toHaveLength(4);
  });

  it('Q1 (variableAccess) has no showIf — always visible', () => {
    const q = DECISION_QUESTIONS.find((q) => q.key === 'variableAccess')!;
    expect(q.showIf).toBeUndefined();
  });

  it('Q2 (mixedResources) has no showIf — always visible', () => {
    const q = DECISION_QUESTIONS.find((q) => q.key === 'mixedResources')!;
    expect(q.showIf).toBeUndefined();
  });

  it('Q3 (auditRequired) is hidden when variableAccess=true, visible when false', () => {
    const q = DECISION_QUESTIONS.find((q) => q.key === 'auditRequired')!;
    const base = { mixedResources: false, auditRequired: null, longTermTokenStorage: null } as const;
    expect(q.showIf!({ ...base, variableAccess: true })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: false })).toBe(true);
    expect(q.showIf!({ ...base, variableAccess: null })).toBe(false);
  });

  it('Q4 (longTermTokenStorage) is only shown when variableAccess=true AND mixedResources=false', () => {
    const q = DECISION_QUESTIONS.find((q) => q.key === 'longTermTokenStorage')!;
    const base = { auditRequired: null, longTermTokenStorage: null } as const;
    expect(q.showIf!({ ...base, variableAccess: true,  mixedResources: false })).toBe(true);
    expect(q.showIf!({ ...base, variableAccess: true,  mixedResources: true  })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: false, mixedResources: false })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: null,  mixedResources: null  })).toBe(false);
  });

});
