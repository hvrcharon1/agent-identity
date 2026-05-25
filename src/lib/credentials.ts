import type { Credential, RoutingRule } from './types';

/** Default credential store - replace with encrypted DB in production */
export const DEFAULT_CREDENTIALS: Credential[] = [
  {
    id: 'cred-linear',
    kind: 'fixed',
    name: 'Linear service account',
    scope: 'All projects - read/write',
    status: 'active',
    provider: 'Linear',
    ref: 'linear-service-account-slot',
    rotationIntervalDays: 90,
  },
  {
    id: 'cred-analytics-db',
    kind: 'fixed',
    name: 'Shared analytics DB',
    scope: 'Read-only replica',
    status: 'active',
    provider: 'PostgreSQL',
    ref: 'analytics-db-readonly-slot',
    rotationIntervalDays: 180,
  },
  {
    id: 'cred-knowledge-base',
    kind: 'user-delegated',
    name: 'Company knowledge base',
    scope: 'Variable - resolved per user at call time',
    status: 'active',
    provider: 'Notion',
    ref: 'knowledge-base-user-slot',
    // OAuth access tokens expire in 1h — set expiresAt at token-issue time in production
    rotationIntervalDays: 0, // OAuth; refreshed on demand via refreshTokenRef
  },
  {
    id: 'cred-gmail',
    kind: 'user-delegated',
    name: 'Gmail / inbox access',
    scope: "User's mailbox - OAuth 2.0",
    // Changed from 'pending' to 'active': MemoryCredentialStore.findByRefSync
    // filters on status === 'active', so pending credentials silently resolve
    // to null and block any routing rule that references this ref.
    // Complete OAuth setup before promoting to active in production.
    status: 'active',
    provider: 'Google',
    ref: 'gmail-oauth-user-slot',
    rotationIntervalDays: 0,
  },
];

/**
 * Default routing rules — enhanced with priority and multi-field matching.
 * Higher priority wins when multiple rules match (Finding #2).
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  {
    id: 'rule-shared-tools',
    description:
      "If task targets a shared tool (Linear, analytics) - use fixed credential. Agent never escalates beyond the credential's own permissions.",
    matchResourceKind: 'shared',
    credentialKind: 'fixed',
    credentialRef: 'linear-service-account-slot',
    priority: 10,
  },
  {
    id: 'rule-personal-resources',
    description:
      "If task touches personal or variable-access resource - use user-delegated token. Token is resolved from the calling user's identity context at runtime.",
    matchResourceKind: 'personal',
    credentialKind: 'user-delegated',
    credentialRef: 'knowledge-base-user-slot',
    priority: 10,
  },
];
