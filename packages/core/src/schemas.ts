/**
 * Zod validation schemas for all public types (Task 7).
 *
 * These schemas serve three simultaneous purposes:
 *   1. Runtime validation in route handlers (replace manual field-by-field checks)
 *   2. TypeScript type inference via z.infer<> (no separate type defs needed for input)
 *   3. JSON Schema generation via zod-to-json-schema (feeds OpenAPI spec + Python Pydantic)
 *
 * Usage in a Next.js route handler:
 *   import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';
 *   const parsed = AgentRequestContextSchema.safeParse(body);
 *   if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
 *   const ctx = parsed.data;
 */
import { z } from 'zod';

// ─── Primitive enums ──────────────────────────────────────────────────────────

export const SupportedProviderSchema = z.enum([
  'openai', 'anthropic', 'gemini', 'mistral', 'local',
]);

export const CredentialKindSchema = z.enum(['fixed', 'user-delegated']);

export const CredentialStatusSchema = z.enum(['active', 'pending', 'revoked']);

export const ResourceKindSchema = z.enum(['shared', 'personal']);

export const MigrationPhaseSchema = z.enum([
  'dry-run', 'extract', 'transform', 'load', 'verify', 'rollback',
]);

// ─── Credential ───────────────────────────────────────────────────────────────

export const CredentialSchema = z.object({
  id:                   z.string().min(1),
  kind:                 CredentialKindSchema,
  name:                 z.string().min(1),
  scope:                z.string().min(1),
  status:               CredentialStatusSchema,
  provider:             z.string().optional(),
  ref:                  z.string().min(1),
  expiresAt:            z.string().datetime().optional(),
  lastRotated:          z.string().datetime().optional(),
  refreshTokenRef:      z.string().optional(),
  rotationIntervalDays: z.number().int().positive().optional(),
});

// ─── Routing Rule ─────────────────────────────────────────────────────────────

export const RoutingRuleSchema = z.object({
  id:                z.string().min(1),
  description:       z.string(),
  credentialRef:     z.string().min(1),
  credentialKind:    CredentialKindSchema,
  priority:          z.number().int(),
  matchResourceKind: ResourceKindSchema.optional(),
  matchAction:       z.union([z.string(), z.array(z.string())]).optional(),
  matchProvider:     SupportedProviderSchema.optional(),
  matchUserId:       z.string().optional(),
  matchPhase:        z.union([MigrationPhaseSchema, z.array(MigrationPhaseSchema)]).optional(),
  readOnly:          z.boolean().optional(),
});

// ─── Agent Request Context ────────────────────────────────────────────────────

export const AgentRequestContextSchema = z.object({
  userId:        z.string().min(1),
  resourceId:    z.string().min(1),
  resourceKind:  ResourceKindSchema,
  provider:      SupportedProviderSchema,
  model:         z.string().min(1),
  action:        z.string().min(1),
  traceId:       z.string().min(1),
  sessionId:     z.string().optional(),
  requestedAt:   z.string().datetime(),
  parentTraceId: z.string().optional(),
});

// ─── Migration Context ────────────────────────────────────────────────────────

export const MigrationContextSchema = AgentRequestContextSchema.extend({
  migrationId:      z.string().min(1),
  phase:            MigrationPhaseSchema,
  sourceResourceId: z.string().min(1),
  targetResourceId: z.string().min(1),
  dryRun:           z.boolean(),
  batchIndex:       z.number().int().nonnegative().optional(),
  totalBatches:     z.number().int().positive().optional(),
});

// ─── Resolved Credential ──────────────────────────────────────────────────────

export const ResolvedCredentialSchema = z.object({
  credentialId: z.string().min(1),
  kind:         CredentialKindSchema,
  ref:          z.string().min(1),
  resolvedFor:  z.string().min(1),
});

// ─── Audit Log Entry ──────────────────────────────────────────────────────────

export const AuditLogEntrySchema = z.object({
  timestamp:      z.string().datetime(),
  traceId:        z.string().min(1),
  userId:         z.string().min(1),
  action:         z.string().min(1),
  resourceId:     z.string().min(1),
  resourceKind:   ResourceKindSchema,
  provider:       SupportedProviderSchema,
  model:          z.string().min(1),
  credentialId:   z.string().min(1),
  credentialKind: CredentialKindSchema,
  resolvedFor:    z.string().min(1),
});

export const MigrationAuditLogEntrySchema = AuditLogEntrySchema.extend({
  migrationId:        z.string().min(1),
  phase:              MigrationPhaseSchema,
  rowsRead:           z.number().int().nonnegative().optional(),
  rowsWritten:        z.number().int().nonnegative().optional(),
  rowsFailed:         z.number().int().nonnegative().optional(),
  dryRun:             z.boolean(),
  sourceCredentialId: z.string().min(1),
  targetCredentialId: z.string().min(1),
  errorSummary:       z.string().optional(),
});

// ─── Migrate Resolve Request (POST /api/migrate/resolve body) ─────────────────

export const MigrateResolveRequestSchema = z.object({
  migrationId:      z.string().min(1),
  phase:            MigrationPhaseSchema,
  sourceResourceId: z.string().min(1),
  targetResourceId: z.string().min(1),
  userId:           z.string().min(1),
  provider:         SupportedProviderSchema,
  model:            z.string().min(1),
  traceId:          z.string().min(1),
  dryRun:           z.boolean().default(false),
  batchIndex:       z.number().int().nonnegative().optional(),
  totalBatches:     z.number().int().positive().optional(),
});

// ─── TypeScript types inferred from schemas (no duplication with types.ts) ────

export type AgentRequestContextInput  = z.infer<typeof AgentRequestContextSchema>;
export type MigrationContextInput     = z.infer<typeof MigrationContextSchema>;
export type RoutingRuleInput          = z.infer<typeof RoutingRuleSchema>;
export type CredentialInput           = z.infer<typeof CredentialSchema>;
export type MigrateResolveRequestInput = z.infer<typeof MigrateResolveRequestSchema>;
