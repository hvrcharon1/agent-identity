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
  },
  {
    id: 'cred-analytics-db',
    kind: 'fixed',
    name: 'Shared analytics DB',
    scope: 'Read-only replica',
    status: 'active',
    provider: 'PostgreSQL',
    ref: 'analytics-db-readonly-slot',
  },
  {
    id: 'cred-knowledge-base',
    kind: 'user-delegated',
    name: 'Company knowledge base',
    scope: 'Variable - resolved per user at call time',
    status: 'active',
    provider: 'Notion',
    ref: 'knowledge-base-user-slot',
  },
  {
    id: 'cred-gmail',
    kind: 'user-delegated',
    name: 'Gmail / inbox access',
    scope: "User's mailbox - OAuth 2.0",
    status: 'pending',
    provider: 'Google',
    ref: 'gmail-oauth-user-slot',
  },
];

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  {
    id: 'rule-shared-tools',
    resourceKind: 'shared',
    credentialKind: 'fixed',
    credentialRef: 'linear-service-account-slot',
    description:
      "If task targets a shared tool (Linear, analytics) - use fixed credential. Agent never escalates beyond the credential's own permissions.",
  },
  {
    id: 'rule-personal-resources',
    resourceKind: 'personal',
    credentialKind: 'user-delegated',
    credentialRef: 'knowledge-base-user-slot',
    description:
      "If task touches personal or variable-access resource - use user-delegated token. Token is resolved from the calling user's identity context at runtime.",
  },
];
