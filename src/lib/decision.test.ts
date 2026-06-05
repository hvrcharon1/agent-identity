/**
 * Unit tests for computeDecision and DECISION_QUESTIONS.
 * Expanded from 8 → 14 tests + DECISION_QUESTIONS suite.
 * Regression guards for all 5 bugs fixed in this session.
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
    expect(computeDecision(answers({ variableAccess: false, mixedResources: false }))).toBeNull();
    expect(computeDecision(answers({ variableAccess: false, mixedResources: true }))).toBeNull();
  });

  it('context-switched resolves immediately from Q1+Q2 — no Q3/Q4 gate (Bug 1 regression guard)', () => {
    const result = computeDecision(answers({ variableAccess: true, mixedResources: true }));
    expect(result?.pattern).toBe('context-switched');
  });

  it('context-switched result is identical regardless of Q3/Q4 values', () => {
    const withAll  = computeDecision(answers({ variableAccess: true, mixedResources: true, auditRequired: true,  longTermTokenStorage: true  }));
    const withNone = computeDecision(answers({ variableAccess: true, mixedResources: true, auditRequired: false, longTermTokenStorage: false }));
    expect(withAll?.pattern).toBe('context-switched');
    expect(withNone?.pattern).toBe('context-switched');
    expect(withAll?.label).toBe(withNone?.label);
  });

  it('token-exchange: variableAccess=true, mixedResources=false, longTermTokenStorage=false', () => {
    const result = computeDecision(answers({ variableAccess: true, mixedResources: false, auditRequired: false, longTermTokenStorage: false }));
    expect(result?.pattern).toBe('token-exchange');
  });

  it('individual-user-auth: variableAccess=true, mixedResources=false, longTermTokenStorage=true', () => {
    const result = computeDecision(answers({ variableAccess: true, mixedResources: false, auditRequired: true, longTermTokenStorage: true }));
    expect(result?.pattern).toBe('individual-user-auth');
  });

  it('fixed-credential: !variableAccess, !mixedResources, !auditRequired', () => {
    const result = computeDecision(answers({ variableAccess: false, mixedResources: false, auditRequired: false }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toBe('Fixed credential');
  });

  it('fixed-credential + request tagging: !variableAccess, !mixedResources, auditRequired=true', () => {
    const result = computeDecision(answers({ variableAccess: false, mixedResources: false, auditRequired: true }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('tagging');
    expect(result?.label).not.toContain('resource-type');
  });

  it('resource-type awareness only: !variableAccess, mixedResources=true, !auditRequired', () => {
    const result = computeDecision(answers({ variableAccess: false, mixedResources: true, auditRequired: false }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('resource-type awareness');
    expect(result?.label).not.toContain('tagging');
  });

  it('resource-type awareness + tagging: !variableAccess, mixedResources=true, auditRequired=true (Bug 3 regression guard)', () => {
    const result = computeDecision(answers({ variableAccess: false, mixedResources: true, auditRequired: true }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('resource-type awareness');
    expect(result?.label).toContain('tagging');
  });

  it('longTermTokenStorage=null does not block fixed-access results', () => {
    const result = computeDecision(answers({ variableAccess: false, mixedResources: false, auditRequired: true, longTermTokenStorage: null }));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('fixed-credential');
  });

  it('auditRequired=null does not block context-switched', () => {
    const result = computeDecision(answers({ variableAccess: true, mixedResources: true, auditRequired: null }));
    expect(result?.pattern).toBe('context-switched');
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

  it('Q3 (auditRequired) hidden when variableAccess=true, visible when false (Bug 2 guard)', () => {
    const q    = DECISION_QUESTIONS.find((q) => q.key === 'auditRequired')!;
    const base = { mixedResources: false, auditRequired: null, longTermTokenStorage: null } as const;
    expect(q.showIf!({ ...base, variableAccess: true  })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: false })).toBe(true);
    expect(q.showIf!({ ...base, variableAccess: null  })).toBe(false);
  });

  it('Q4 (longTermTokenStorage) only shown when variableAccess=true AND mixedResources=false (Bug 4 guard)', () => {
    const q    = DECISION_QUESTIONS.find((q) => q.key === 'longTermTokenStorage')!;
    const base = { auditRequired: null, longTermTokenStorage: null } as const;
    expect(q.showIf!({ ...base, variableAccess: true,  mixedResources: false })).toBe(true);
    expect(q.showIf!({ ...base, variableAccess: true,  mixedResources: true  })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: false, mixedResources: false })).toBe(false);
    expect(q.showIf!({ ...base, variableAccess: null,  mixedResources: null  })).toBe(false);
  });

});
