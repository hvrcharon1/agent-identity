/**
 * @datacules/agent-identity — public API
 *
 * Provider-agnostic credential routing and identity management for AI agents.
 * The model/LLM layer never receives raw credentials.
 *
 * @example
 * ```typescript
 * import { createRouter } from '@datacules/agent-identity';
 *
 * const router = createRouter(credentials, rules, logger);
 * const resolved = router.resolve(ctx);
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  // Identity
  IdentityType,
  Identity,
  // Auth patterns
  AuthPatternType,
  AuthPattern,
  FlowNode,
  // Credentials
  CredentialKind,
  CredentialStatus,
  Credential,
  // Routing
  ResourceKind,
  RoutingRule,
  // Request context
  AgentRequestContext,
  ResolvedCredential,
  // Migration
  MigrationPhase,
  MigrationContext,
  ResolvedCredentialPair,
  // Providers
  SupportedProvider,
  ProviderAdapter,
  // Store & audit
  CredentialStore,
  AuditLogEntry,
  MigrationAuditLogEntry,
  AuditLogger,
  MigrationAuditLogger,
  MigrationSummary,
  // Decision
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
export { getAdapter, PROVIDER_ADAPTERS, registerProvider } from './providers';

// ─── Decision helper ──────────────────────────────────────────────────────────
export { computeDecision } from './decision';

// ─── Default credentials (for local dev / demos) ─────────────────────────────
export { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from './credentials';
