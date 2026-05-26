import type { Credential, RoutingRule } from './types';

export const DEFAULT_CREDENTIALS: Credential[] = [
  { id: 'cred-linear', kind: 'fixed', name: 'Linear service account', scope: 'All projects - read/write', status: 'active', provider: 'Linear', ref: 'linear-service-account-slot', rotationIntervalDays: 90 },
  { id: 'cred-analytics-db', kind: 'fixed', name: 'Shared analytics DB', scope: 'Read-only replica', status: 'active', provider: 'PostgreSQL', ref: 'analytics-db-readonly-slot', rotationIntervalDays: 180 },
  { id: 'cred-knowledge-base', kind: 'user-delegated', name: 'Company knowledge base', scope: 'Variable - resolved per user at call time', status: 'active', provider: 'Notion', ref: 'knowledge-base-user-slot', rotationIntervalDays: 0 },
  { id: 'cred-gmail', kind: 'user-delegated', name: 'Gmail / inbox access', scope: "User's mailbox - OAuth 2.0", status: 'active', provider: 'Google', ref: 'gmail-oauth-user-slot', rotationIntervalDays: 0 },
];

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { id: 'rule-shared-tools', description: 'Shared tools → fixed service account', matchResourceKind: 'shared', credentialKind: 'fixed', credentialRef: 'linear-service-account-slot', priority: 10 },
  { id: 'rule-personal-resources', description: 'Personal resources → user-delegated token', matchResourceKind: 'personal', credentialKind: 'user-delegated', credentialRef: 'knowledge-base-user-slot', priority: 10 },
];
