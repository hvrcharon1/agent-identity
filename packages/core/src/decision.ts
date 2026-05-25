/**
 * Decision helper — core publishable package.
 * Identical logic to src/lib/decision.ts.
 */
import type { DecisionAnswers, DecisionResult } from './types';

export function computeDecision(answers: DecisionAnswers): DecisionResult | null {
  const { variableAccess, mixedResources, auditRequired, longTermTokenStorage } = answers;

  if (variableAccess === null || mixedResources === null || auditRequired === null) return null;
  if (variableAccess && longTermTokenStorage === null) return null;

  if (variableAccess && mixedResources) {
    return {
      pattern: 'context-switched',
      label: 'Hybrid (context-switched)',
      explanation:
        'Your agent needs both fixed credentials for shared resources and user-delegated tokens for personal data. Set explicit routing rules so the agent always knows which to use.',
    };
  }

  if (variableAccess && !mixedResources) {
    if (!longTermTokenStorage) {
      return {
        pattern: 'token-exchange',
        label: 'Token exchange / impersonation',
        explanation:
          'You need per-user access but cannot store tokens long-term. Use OAuth token exchange or STS assume-role to get scoped user tokens at request time, without persisting them.',
      };
    }
    return {
      pattern: 'individual-user-auth',
      label: 'Individual user auth',
      explanation:
        "Users have different access levels, so each request must carry that user's own token. The agent passes it through; the downstream resource enforces the ACL.",
    };
  }

  if (!variableAccess && mixedResources) {
    return {
      pattern: 'fixed-credential',
      label: 'Fixed credential with resource-type awareness',
      explanation:
        'All users are equal but the agent accesses different resource types. A single fixed credential works — ensure its scope covers both resource types your agent needs.',
    };
  }

  if (!variableAccess && !auditRequired) {
    return {
      pattern: 'fixed-credential',
      label: 'Fixed credential',
      explanation:
        "All users are equal and audit trail isn't critical. A single service account keeps setup simple. Store the key encrypted; never pass it to the model layer.",
    };
  }

  return {
    pattern: 'fixed-credential',
    label: 'Fixed credential + request tagging',
    explanation:
      "Use a shared service account, but tag each request with the calling user's ID in your own logs. Gives you the simplicity of a fixed credential with an audit trail layer above it.",
  };
}
