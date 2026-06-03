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

// ─── Rotation Policy ─────────────────────────────────────────────────────────

export interface RotationPolicy {
  rotateAfterDays?: number;
  rotateAfterUses?: number;
  gracePeriodSeconds?: number;
  notifyBeforeDays?: number;
  /** Matches a registered RotationProvider.id */
  provisioner?: string;
}

// ─── Budget Policy ────────────────────────────────────────────────────────────

export interface BudgetPolicy {
  maxResolutionsPerHour?: number;
  maxConcurrentSessions?: number;
  maxDailySpendUsd?: number;
  /** Percentage of any limit at which to emit a budget_warning event (default: 80) */
  softThresholdPercent?: number;
  /** Cron expression for reset schedule (default: daily midnight UTC) */
  resetSchedule?: string;
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export type CredentialKind = 'fixed' | 'user-delegated';

/**
 * Lifecycle status for a Credential:
 *   active    — fully trusted; scope is as declared
 *   pending   — being provisioned; not yet usable
 *   unclaimed — anonymous auth.md registration; holds pre-claim scopes only;
 *               not routable until the claim ceremony completes and status
 *               is flipped to 'active'
 *   revoked   — invalid; must not be resolved
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
  /** ISO 8601 — undefined means does not expire */
  expiresAt?: string;
  lastRotated?: string;
  refreshTokenRef?: string;
  rotationIntervalDays?: number;
  /** Automated rotation policy — undefined means manual rotation only */
  rotation?: RotationPolicy;
  /** Usage budget enforcement policy */
  budget?: BudgetPolicy;
  /** Arbitrary tags e.g. ['pii', 'financial', 'prod'] — used by compliance reports */
  tags?: string[];

  /**
   * For status='unclaimed': the scopes the credential currently carries
   * (pre-claim). Once the claim ceremony completes, replaced with
   * postClaimScopes and status flipped to 'active'.
   */
  preClaimScopes?: string[];

  /**
   * For status='unclaimed': the scopes this credential will carry once
   * the claim ceremony is completed. Informational until claim completes.
   */
  postClaimScopes?: string[];

  /**
   * ISO 8601 timestamp when the auth.md claim ceremony was completed.
   * Set by AgentAuthMdStore.completeClaimCeremony().
   */
  claimedAt?: string;

  /**
   * Token required to complete an ongoing claim ceremony.
   * NEVER persisted to any external store — held in memory only.
   * Present only on the in-memory Credential inside AgentAuthMdStore's cache.
   */
  claimToken?: string;
}

// ─── Approval Policy ──────────────────────────────────────────────────────────

export type ApproverKind = 'webhook' | 'email' | 'slack';

export interface Approver {
  kind: ApproverKind;
  /** Webhook URL, email address, or Slack channel ID */
  target: string;
}

export interface ApprovalPolicy {
  /**
   * Minimum number of approvers that must approve before the credential
   * resolves. Set to 1 for standard single-approver gates.
   */
  requiredApprovers: number;
  /**
   * List of approvers to notify. Each entry specifies the channel (webhook,
   * email, slack) and the target address or URL.
   */
  approvers: Approver[];
  /** Seconds before the request auto-times-out (default: 300) */
  timeoutSeconds?: number;
  breakGlass?: {
    /** User ID authorised for emergency override */
    approver: string;
    requireJustification?: boolean;
  };
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export type ResourceKind = 'shared' | 'personal';

export interface RoutingRule {
  id: string;
  description: string;
  credentialRef: string;
  credentialKind: CredentialKind;
  priority: number;
  matchResourceKind?: ResourceKind;
  matchAction?: string | string[];
  matchProvider?: SupportedProvider;
  matchUserId?: string;
  matchPhase?: MigrationPhase | MigrationPhase[];
  matchSpiffeId?: string;
  readOnly?: boolean;
  /** Secondary credential ref receiving canaryWeight % of traffic */
  canaryRef?: string;
  /** 0–100 — percentage of traffic routed to canaryRef (default: 0) */
  canaryWeight?: number;
  /** Approval required before credential resolves */
  approval?: ApprovalPolicy;
}

// ─── Agent Request Context ────────────────────────────────────────────────────

export interface AgentRequestContext {
  userId: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  action: string;
  traceId: string;
  sessionId?: string;
  requestedAt: string;
  parentTraceId?: string;
  /** SPIFFE SVID of the calling workload (set by SpiffeCredentialStore) */
  spiffeId?: string;
}

export interface ResolvedCredential {
  credentialId: string;
  kind: CredentialKind;
  ref: string;
  resolvedFor: string;
  /** ISO 8601 expiry of this resolved credential */
  expiresAt?: string;
  /** Signed JWT attestation — present when AttestationSigner is configured */
  credentialAttestation?: string;
  /** True when this resolution was routed to the canary ref */
  isCanary?: boolean;
  /**
   * The scope string from the matched Credential (e.g. "Read-only replica",
   * "All projects - read/write"). Populated by the router from Credential.scope.
   * Used by validateForMigration() for explicit read/write enforcement, replacing
   * ref-string naming heuristics. Set Credential.scope to get authoritative
   * enforcement; omit it to fall back to ref-string heuristics.
   */
  scope?: string;
}

// ─── Migration Types ──────────────────────────────────────────────────────────

export type MigrationPhase =
  | 'dry-run'
  | 'extract'
  | 'transform'
  | 'load'
  | 'verify'
  | 'rollback';

export interface MigrationContext extends AgentRequestContext {
  migrationId: string;
  phase: MigrationPhase;
  sourceResourceId: string;
  targetResourceId: string;
  batchIndex?: number;
  totalBatches?: number;
  dryRun: boolean;
}

export interface ResolvedCredentialPair {
  source: ResolvedCredential;
  target: ResolvedCredential;
  migrationId: string;
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
  injectCredential(
    request: Record<string, unknown>,
    credential: ResolvedCredential
  ): Record<string, unknown>;
  validate?(request: Record<string, unknown>): void;
  validateForMigration?(
    credential: ResolvedCredential,
    phase: MigrationPhase
  ): void;
}

// ─── Credential Store & Audit ─────────────────────────────────────────────────

export interface CredentialStore {
  findByRef(ref: string): Promise<Credential | null>;
  listActive(): Promise<Credential[]>;
  listByKind(kind: CredentialKind): Promise<Credential[]>;
  reserve?(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean>;
  release?(ref: string, migrationId: string): Promise<void>;

  /**
   * Revoke all credentials that match the given identity triple.
   *
   * Called when a logout+jwt is received at revocation_uri from a trusted
   * identity provider. Implementations should mark all matching credentials as
   * status='revoked' and clear any cached resolved values.
   *
   * @param issuer   - iss claim from the logout+jwt (provider base URL)
   * @param subject  - sub claim (user identifier at the provider)
   * @param audience - aud claim (this service's auth server URL)
   * @returns number of credentials revoked
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
  /** True when this entry was routed via canary */
  isCanary?: boolean;
  /** Identity chain for federated agent calls */
  identityChain?: IdentityChainEntry[];
  /** SPIFFE ID of the calling workload */
  spiffeId?: string;
}

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

/**
 * AuditLogger — the core audit interface.
 *
 * log() accepts both synchronous (void) and asynchronous (Promise<void>)
 * implementations. This union return type ensures that:
 *   - Synchronous loggers (ConsoleAuditLogger, HashChainAuditLogger) satisfy
 *     the interface without wrapping every call in a Promise.
 *   - Async loggers (WebhookAuditLogger, DatadogAuditLogger) can return a
 *     Promise that callers may await.
 *
 * Callers that need guaranteed delivery should await the result:
 *   await logger.log(entry);
 * Callers using fire-and-forget patterns may call without await.
 */
export interface AuditLogger {
  log(entry: AuditLogEntry): void | Promise<void>;
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

// ─── Decision Helper ──────────────────────────────────────────────────────────

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

// ─── Attestation ──────────────────────────────────────────────────────────────

export interface AttestationSigner {
  /** Sign a payload and return a compact JWT string */
  sign(payload: Record<string, unknown>): Promise<string>;
  /** Verify a compact JWT string; returns the payload or null if invalid */
  verify(token: string): Promise<Record<string, unknown> | null>;
}

export interface AttestationPayload {
  iss: string;
  sub: string;
  credentialId: string;
  resolvedFor: string;
  action: string;
  resourceId: string;
  traceId: string;
  ruleId?: string;
  iat: number;
  exp: number;
}

// ─── Approval ────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'break_glass';

export interface ApprovalRequest {
  requestId: string;
  credentialId: string;
  ruleId: string;
  context: AgentRequestContext;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  justification?: string;
  expiresAt: string;
}

// ─── Federation ──────────────────────────────────────────────────────────────

export interface IdentityChainEntry {
  /** Trust domain e.g. 'acme.com' */
  org: string;
  userId: string;
  agentId: string;
  /** ISO 8601 timestamp when this entry was issued */
  issuedAt: string;
  /** Ed25519 signature over the canonical entry JSON */
  signature: string;
}

export interface FederationConfig {
  /** The local org's trust domain */
  trustDomain: string;
  /** Map of trustDomain → base64 public key for verification */
  trustedDomains: Record<string, string>;
}

// ─── Trusted Identity Providers (auth.md) ────────────────────────────────────

/**
 * A trusted identity provider whose ID-JAG assertions this service accepts.
 * Add entries to a TrustedProviderRegistry to gate which assertion issuers
 * are allowed during auth.md registration.
 */
export interface TrustedIdentityProvider {
  /** Issuer URL — must match the iss claim in ID-JAGs from this provider. */
  issuerUrl: string;
  /** Human-readable label e.g. 'OpenAI', 'Anthropic', 'Cursor'. */
  label: string;
  /**
   * JWKS endpoint. If omitted, derived as {issuerUrl}/.well-known/jwks.json
   * per the ID-JAG draft spec.
   */
  jwksUri?: string;
  /**
   * Optional CIMD URL. If the ID-JAG's client_id is a URL (not opaque),
   * fetch it as an OAuth Client ID Metadata Document and verify its jwks_uri
   * matches the one used for signature verification.
   */
  cimdUri?: string;
  /**
   * Policy: require at least one of these AMR values in the ID-JAG.
   * e.g. ['mfa'] enforces MFA at the provider.
   */
  requiredAmr?: string[];
  /** Whether this provider entry is currently active (default: true). */
  enabled?: boolean;
}

/** Registry of identity providers whose ID-JAG assertions are accepted. */
export interface TrustedProviderRegistry {
  providers: TrustedIdentityProvider[];
  /** JWKS cache TTL in ms. Default: 3_600_000 (1 hour). */
  jwksCacheTtlMs?: number;
  /** Minimum JWKS cache floor in ms. Default: 600_000 (10 minutes). */
  jwksCacheFloorMs?: number;
}
