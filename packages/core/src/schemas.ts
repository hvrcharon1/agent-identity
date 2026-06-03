/**
 * @datacules/agent-identity/schemas
 *
 * Zod schemas mirroring every public type. Three uses simultaneously:
 *   1. Runtime validation in route handlers (replaces manual field loops)
 *   2. TypeScript type inference via z.infer<>
 *   3. JSON Schema / OpenAPI generation via zod-to-json-schema
 *
 * Since zod is already in dependencies, this costs nothing to ship.
 */
import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

export const SupportedProviderSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'local',
]);

export const ResourceKindSchema = z.enum(['shared', 'personal']);

export const CredentialKindSchema = z.enum(['fixed', 'user-delegated']);

/**
 * 'unclaimed' added for auth.md anonymous-flow credentials that are
 * awaiting claim ceremony completion before becoming fully active.
 */
export const CredentialStatusSchema = z.enum(['active', 'pending', 'unclaimed', 'revoked']);

export const MigrationPhaseSchema = z.enum([
  'dry-run',
  'extract',
  'transform',
  'load',
  'verify',
  'rollback',
]);

export const ApproverKindSchema = z.enum(['webhook', 'email', 'slack']);

// ─── Rotation Policy ─────────────────────────────────────────────────────────

export const RotationPolicySchema = z.object({
  rotateAfterDays: z.number().int().positive().optional(),
  rotateAfterUses: z.number().int().positive().optional(),
  gracePeriodSeconds: z.number().int().nonnegative().optional(),
  notifyBeforeDays: z.number().int().positive().optional(),
  provisioner: z.string().optional(),
});

// ─── Budget Policy ────────────────────────────────────────────────────────────

export const BudgetPolicySchema = z.object({
  maxResolutionsPerHour: z.number().int().positive().optional(),
  maxConcurrentSessions: z.number().int().positive().optional(),
  maxDailySpendUsd: z.number().positive().optional(),
  softThresholdPercent: z.number().min(0).max(100).optional(),
  resetSchedule: z.string().optional(),
});

// ─── Approval Policy ─────────────────────────────────────────────────────────

export const ApproverSchema = z.object({
  kind: ApproverKindSchema,
  target: z.string().min(1),
});

export const ApprovalPolicySchema = z.object({
  requiredApprovers: z.number().int().positive(),
  approvers: z.array(ApproverSchema),
  timeoutSeconds: z.number().int().positive().optional(),
  breakGlass: z
    .object({
      approver: z.string().min(1),
      requireJustification: z.boolean().optional(),
    })
    .optional(),
});

// ─── Credential ─────────────────────────────────────────────────────────────

export const CredentialSchema = z.object({
  id: z.string().min(1),
  kind: CredentialKindSchema,
  name: z.string().min(1),
  scope: z.string(),
  status: CredentialStatusSchema,
  provider: z.string().optional(),
  ref: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  lastRotated: z.string().datetime().optional(),
  refreshTokenRef: z.string().optional(),
  rotationIntervalDays: z.number().int().nonnegative().optional(),
  rotation: RotationPolicySchema.optional(),
  budget: BudgetPolicySchema.optional(),
  tags: z.array(z.string()).optional(),
  // auth.md claim-ceremony fields
  preClaimScopes: z.array(z.string()).optional(),
  postClaimScopes: z.array(z.string()).optional(),
  claimedAt: z.string().datetime().optional(),
  // claimToken is intentionally omitted from the schema — it must never
  // be serialised or validated at an API boundary; it is held in memory only.
});

// ─── Routing Rule ──────────────────────────────────────────────────────────

export const RoutingRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  credentialRef: z.string().min(1),
  credentialKind: CredentialKindSchema,
  priority: z.number().int(),
  matchResourceKind: ResourceKindSchema.optional(),
  matchAction: z.union([z.string(), z.array(z.string())]).optional(),
  matchProvider: SupportedProviderSchema.optional(),
  matchUserId: z.string().optional(),
  matchPhase: z
    .union([MigrationPhaseSchema, z.array(MigrationPhaseSchema)])
    .optional(),
  matchSpiffeId: z.string().optional(),
  readOnly: z.boolean().optional(),
  canaryRef: z.string().optional(),
  canaryWeight: z.number().int().min(0).max(100).optional(),
  approval: ApprovalPolicySchema.optional(),
});

// ─── Agent Request Context ───────────────────────────────────────────────

export const AgentRequestContextSchema = z.object({
  userId: z.string().min(1),
  resourceId: z.string().min(1),
  resourceKind: ResourceKindSchema,
  provider: SupportedProviderSchema,
  model: z.string().min(1),
  action: z.string().min(1),
  traceId: z.string().min(1),
  sessionId: z.string().optional(),
  requestedAt: z.string().datetime(),
  parentTraceId: z.string().optional(),
  spiffeId: z.string().optional(),
});

export const MigrationContextSchema = AgentRequestContextSchema.extend({
  migrationId: z.string().min(1),
  phase: MigrationPhaseSchema,
  sourceResourceId: z.string().min(1),
  targetResourceId: z.string().min(1),
  dryRun: z.boolean(),
  batchIndex: z.number().int().nonnegative().optional(),
  totalBatches: z.number().int().positive().optional(),
});

// ─── Trusted Identity Providers (auth.md) ──────────────────────────────────

export const TrustedIdentityProviderSchema = z.object({
  issuerUrl: z.string().url(),
  label: z.string().min(1),
  jwksUri: z.string().url().optional(),
  cimdUri: z.string().url().optional(),
  requiredAmr: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const TrustedProviderRegistrySchema = z.object({
  providers: z.array(TrustedIdentityProviderSchema),
  jwksCacheTtlMs: z.number().int().positive().optional(),
  jwksCacheFloorMs: z.number().int().positive().optional(),
});

// ─── TypeScript types derived from schemas ──────────────────────────────────
// (no duplication with types.ts — these are the validated input variants)

export type AgentRequestContextInput = z.infer<typeof AgentRequestContextSchema>;
export type MigrationContextInput    = z.infer<typeof MigrationContextSchema>;
export type RoutingRuleInput         = z.infer<typeof RoutingRuleSchema>;
export type CredentialInput          = z.infer<typeof CredentialSchema>;
export type TrustedIdentityProviderInput = z.infer<typeof TrustedIdentityProviderSchema>;
export type TrustedProviderRegistryInput = z.infer<typeof TrustedProviderRegistrySchema>;
