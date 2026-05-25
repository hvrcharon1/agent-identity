/**
 * @datacules/agent-identity — public API barrel export
 *
 * Install:  npm install @datacules/agent-identity
 * React:    import { useAgentIdentity } from '@datacules/agent-identity/react';
 * Schemas:  import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  AgentRequestContext,
  MigrationContext,
  MigrationPhase,
  ResolvedCredential,
  ResolvedCredentialPair,
  RoutingRule,
  Credential,
  CredentialKind,
  CredentialStatus,
  CredentialStore,
  AuditLogger,
  AuditLogEntry,
  MigrationAuditLogEntry,
  MigrationAuditLogger,
  MigrationSummary,
  ProviderAdapter,
  SupportedProvider,
  ResourceKind,
  IdentityType,
  Identity,
  AuthPatternType,
  DecisionAnswers,
  DecisionResult,
} from './types';

// ─── Router ───────────────────────────────────────────────────────────────────
export {
  CredentialRouter,
  MemoryCredentialStore,
  createRouter,
  createRouterFromStore,
} from './router';

// ─── Providers ────────────────────────────────────────────────────────────────
export { getAdapter, PROVIDER_ADAPTERS } from './providers';

// ─── Decision helper ──────────────────────────────────────────────────────────
export { computeDecision } from './decision';
