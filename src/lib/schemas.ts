/**
 * Zod validation schemas re-exported for the Next.js app layer.
 *
 * The canonical schema source is packages/core/src/schemas.ts.
 * This file simply re-exports from there so Next.js route handlers
 * can import via the '@/lib/schemas' alias without any build step.
 *
 * Once @datacules/agent-identity is published to npm, this shim can be
 * replaced by:
 *   import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';
 */
export {
  SupportedProviderSchema,
  CredentialKindSchema,
  CredentialStatusSchema,
  ResourceKindSchema,
  MigrationPhaseSchema,
  CredentialSchema,
  RoutingRuleSchema,
  AgentRequestContextSchema,
  MigrationContextSchema,
  ResolvedCredentialSchema,
  AuditLogEntrySchema,
  MigrationAuditLogEntrySchema,
  MigrateResolveRequestSchema,
} from '../../packages/core/src/schemas';

export type {
  AgentRequestContextInput,
  MigrationContextInput,
  RoutingRuleInput,
  CredentialInput,
  MigrateResolveRequestInput,
} from '../../packages/core/src/schemas';
