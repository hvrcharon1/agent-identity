/**
 * Unit tests for computeDecision — covers all 8+ boolean permutations (Finding #3).
 */
import { describe, it, expect } from 'vitest';
import { computeDecision } from './decision';
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
  it('returns null when any Q1-Q3 answer is missing', () => {
    expect(computeDecision(answers({}))).toBeNull();
    expect(computeDecision(answers({ variableAccess: true }))).toBeNull();
    expect(computeDecision(answers({ variableAccess: true, mixedResources: false }))).toBeNull();
  });

  it('returns null when variableAccess=true but Q4 unanswered', () => {
    expect(computeDecision(answers({ variableAccess: true, mixedResources: false, auditRequired: false }))).toBeNull();
  });

  it('context-switched: variableAccess=true, mixedResources=true', () => {
    const result = computeDecision(answers({
      variableAccess: true, mixedResources: true, auditRequired: true, longTermTokenStorage: true,
    }));
    expect(result?.pattern).toBe('context-switched');
  });

  it('token-exchange: variableAccess=true, mixedResources=false, longTermTokenStorage=false', () => {
    const result = computeDecision(answers({
      variableAccess: true, mixedResources: false, auditRequired: false, longTermTokenStorage: false,
    }));
    expect(result?.pattern).toBe('token-exchange');
  });

  it('individual-user-auth: variableAccess=true, mixedResources=false, longTermTokenStorage=true', () => {
    const result = computeDecision(answers({
      variableAccess: true, mixedResources: false, auditRequired: true, longTermTokenStorage: true,
    }));
    expect(result?.pattern).toBe('individual-user-auth');
  });

  it('fixed-credential with resource-type awareness: !variableAccess, mixedResources=true (Finding #9 — previously null)', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: true, auditRequired: false, longTermTokenStorage: null,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('resource-type awareness');
  });

  it('fixed-credential: !variableAccess, !mixedResources, !auditRequired', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: false, auditRequired: false, longTermTokenStorage: null,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toBe('Fixed credential');
  });

  it('fixed-credential + request tagging: !variableAccess, !mixedResources, auditRequired=true', () => {
    const result = computeDecision(answers({
      variableAccess: false, mixedResources: false, auditRequired: true, longTermTokenStorage: null,
    }));
    expect(result?.pattern).toBe('fixed-credential');
    expect(result?.label).toContain('tagging');
  });
});
