/**
 * Re-exports all types from @datacules/agent-identity (packages/core).
 *
 * Previously this file maintained a manually-synced copy of core types.
 * Now it is a thin barrel so that existing `@/lib/types` imports continue
 * to resolve without changes to consuming files.
 */
export type {
  IdentityType,
  Identity,
  AuthPatternType,
  AuthPattern,
  FlowNode,
  RotationPolicy,
  BudgetPolicy,
  CredentialKind,
  CredentialStatus,
  Credential,
  ResourceKind,
  RoutingRule,
  AgentRequestContext,
  ResolvedCredential,
  MigrationPhase,
  MigrationContext,
  ResolvedCredentialPair,
  SupportedProvider,
  ProviderAdapter,
  CredentialStore,
  AuditLogEntry,
  MigrationAuditLogEntry,
  AuditLogger,
  MigrationAuditLogger,
  MigrationSummary,
  DecisionAnswers,
  DecisionResult,
  ApprovalStatus,
  ApprovalRequest,
} from '@datacules/agent-identity';
