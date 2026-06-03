// ─── Identity Types ───────────────────────────────────────────────────────────

export type IdentityType =
  | 'user-delegated'
  | 'fixed-service'
  | 'hybrid'
  | 'agent-as-service';

export interface Identity {
  id: string;
  type: IdentityType;
  name: string;
  description: string;
  tags: string[];
}

// ─── Auth Patterns ────────────────────────────────────────────────────────────

export type AuthPatternType =
  | 'individual-user-auth'
  | 'fixed-credential'
  | 'context-switched'
  | 'token-exchange';

export interface AuthPattern {
  id: AuthPatternType;
  name: string;
  description: string;
  badgeLabel: string;
  recommended?: boolean;
  flowNodes: FlowNode[];
}

export interface FlowNode {
  label: string;
  sublabel: string;
  variant: 'default' | 'blue' | 'red' | 'green' | 'amber';
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export type CredentialKind = 'fixed' | 'user-delegated';

/**
 * Lifecycle status for a Credential.
 * 'unclaimed' is added for auth.md anonymous-flow credentials that have not
 * yet completed the OTP claim ceremony — they carry pre-claim scopes only
 * and must not be resolved by the router until upgraded to 'active'.
 */
export type CredentialStatus = 'active' | 'pending' | 'unclaimed' | 'revoked';

export interface Credential {
  id: string;
  kind: CredentialKind;
  name: string;
  scope: string;
  status: CredentialStatus;
  provider?: string;
  /** Never the raw secret — a reference/slot identifier */
  ref: string;
  // ── Expiry & rotation fields (Finding #7) ──────────────────────────────
  /** ISO 8601 — undefined means does not expire */
  expiresAt?: string;
  /** ISO 8601 — for audit and rotation scheduling */
  lastRotated?: string;
  /** Encrypted ref to refresh token in store */
  refreshTokenRef?: string;
  /** Policy: rotate every N days */
  rotationIntervalDays?: number;
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export type ResourceKind = 'shared' | 'personal';

/**
 * Enhanced RoutingRule with priority scoring and multi-field matching (Finding #2).
 * All match fields are optional — omit to match any value.
 * Higher priority number wins when multiple rules match.
 *
 * Migration enhancements: matchPhase and readOnly added.
 */
export interface RoutingRule {
  id: string;
  description: string;
  credentialRef: string;
  credentialKind: CredentialKind;
  /** Higher number wins over lower-priority rules */
  priority: number;
  /** Omit to match any resourceKind */
  matchResourceKind?: ResourceKind;
  /** e.g. 'write' or ['write', 'delete'] */
  matchAction?: string | string[];
  /** e.g. 'openai' — omit to match any provider */
  matchProvider?: SupportedProvider;
  /** Exact userId match — omit to match any user */
  matchUserId?: string;
  /**
   * Migration: match only when the request is in one of these phases.
   * Omit to match any phase (or non-migration requests).
   */
  matchPhase?: MigrationPhase | MigrationPhase[];
  /**
   * Migration: when true the router validates that the resolved credential
   * scope includes 'read' before returning it.  Enforces read-only on dry-runs.
   */
  readOnly?: boolean;
}

// ─── Agent Request Context ───────────────────────────────────────────────────

export interface AgentRequestContext {
  userId: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  action: string;
  // ── Tracing fields (Finding #11) ─────────────────────────────────────
  /** Propagate across all steps of a multi-step agent run */
  traceId: string;
  /** Groups related requests for the same user session */
  sessionId?: string;
  /** ISO 8601 — when the request was initiated */
  requestedAt: string;
  /** For nested agent calls (agent calling another agent) */
  parentTraceId?: string;
}

export interface ResolvedCredential {
  credentialId: string;
  kind: CredentialKind;
  ref: string;
  resolvedFor: string; // userId or 'service'
  /**
   * The scope string from the matched Credential (e.g. "Read-only replica",
   * "All projects - read/write"). Populated by the router from Credential.scope.
   * Used by validateForMigration() for explicit read/write enforcement.
   */
  scope?: string;
}

// ─── Migration Types ──────────────────────────────────────────────────────────

/**
 * Ordered phases of a data migration run.
 * The agent follows: dry-run → extract → transform → load → verify
 * and may fall back to rollback if load or verify fails.
 */
export type MigrationPhase =
  | 'dry-run'
  | 'extract'
  | 'transform'
  | 'load'
  | 'verify'
  | 'rollback';

/**
 * Extends AgentRequestContext with migration-specific fields.
 * Routing rules can match on `phase`, and the router can enforce
 * separate credentials for source (read) and target (write).
 */
export interface MigrationContext extends AgentRequestContext {
  /** Ties all phases of one migration run together across audit entries */
  migrationId: string;
  phase: MigrationPhase;
  /** resourceId of the system data is coming FROM */
  sourceResourceId: string;
  /** resourceId of the system data is going TO */
  targetResourceId: string;
  /** For paginated large-dataset migrations */
  batchIndex?: number;
  totalBatches?: number;
  /**
   * When true the router enforces read-only credential resolution.
   * Use for preflight checks before any data moves.
   */
  dryRun: boolean;
}

/**
 * Holds both resolved credentials for a single migration step.
 * Returned by CredentialRouter.resolvePair().
 */
export interface ResolvedCredentialPair {
  source: ResolvedCredential;
  target: ResolvedCredential;
  migrationId: string;
  /** ISO 8601 — earliest expiry of the two credentials */
  expiresAt?: string;
}

// ─── Providers ────────────────────────────────────────────────────────────────

export type SupportedProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'local';

export interface ProviderAdapter {
  id: SupportedProvider;
  label: string;
  /** Inject resolved credential into provider-specific request headers/params */
  injectCredential(
    request: Record<string, unknown>,
    credential: ResolvedCredential
  ): Record<string, unknown>;
  /**
   * Optional — validate the request before sending to the real API.
   * Throw an Error if required fields are missing (Finding #12).
   */
  validate?(request: Record<string, unknown>): void;
  /**
   * Migration: validate that `credential` is appropriate for `phase`.
   * For example: load/rollback phases require a write-scoped credential.
   * Throw an Error if the scope is incompatible — catches misconfigurations
   * before any data moves.
   */
  validateForMigration?(
    credential: ResolvedCredential,
    phase: MigrationPhase
  ): void;
}

// ─── Credential Store & Audit (Finding #5) ───────────────────────────────────

export interface CredentialStore {
  findByRef(ref: string): Promise<Credential | null>;
  listActive(): Promise<Credential[]>;
  listByKind(kind: CredentialKind): Promise<Credential[]>;
  /**
   * Migration: reserve `ref` for exclusive use during a migration window.
   */
  reserve?(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Migration: release a previously reserved credential.
   */
  release?(ref: string, migrationId: string): Promise<void>;
  /**
   * Revoke all credentials matching the given identity triple.
   * Called when a logout+jwt is received at revocation_uri from a trusted
   * identity provider. Added for auth.md backchannel logout support.
   */
  revokeByIdentity?(
    issuer: string,
    subject: string,
    audience: string
  ): Promise<number>;
}

export interface AuditLogEntry {
  timestamp: string;
  traceId: string;
  userId: string;
  action: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  credentialId: string;
  credentialKind: CredentialKind;
  resolvedFor: string;
}

/**
 * Extends AuditLogEntry with migration-specific fields.
 */
export interface MigrationAuditLogEntry extends AuditLogEntry {
  migrationId: string;
  phase: MigrationPhase;
  rowsRead?: number;
  rowsWritten?: number;
  rowsFailed?: number;
  dryRun: boolean;
  sourceCredentialId: string;
  targetCredentialId: string;
  errorSummary?: string;
}

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}

export interface MigrationAuditLogger extends AuditLogger {
  summarize(migrationId: string): Promise<MigrationSummary>;
}

export interface MigrationSummary {
  migrationId: string;
  phases: MigrationPhase[];
  totalRowsRead: number;
  totalRowsWritten: number;
  totalRowsFailed: number;
  startedAt: string;
  completedAt?: string;
  errors: string[];
}

// ─── Decision Helper ─────────────────────────────────────────────────────────

export interface DecisionAnswers {
  variableAccess: boolean | null;
  mixedResources: boolean | null;
  auditRequired: boolean | null;
  longTermTokenStorage: boolean | null;
}

export interface DecisionResult {
  pattern: AuthPatternType;
  label: string;
  explanation: string;
}
