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
export type CredentialStatus = 'active' | 'pending' | 'revoked';

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
}

// ─── Credential Store & Audit (Finding #5) ───────────────────────────────────

export interface CredentialStore {
  findByRef(ref: string): Promise<Credential | null>;
  listActive(): Promise<Credential[]>;
  listByKind(kind: CredentialKind): Promise<Credential[]>;
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

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}

// ─── Decision Helper ─────────────────────────────────────────────────────────

export interface DecisionAnswers {
  variableAccess: boolean | null;       // Q1: do users have different access levels?
  mixedResources: boolean | null;       // Q2: both shared and personal resources?
  auditRequired: boolean | null;        // Q3: per-user audit trail needed?
  longTermTokenStorage: boolean | null; // Q4: can you store per-user tokens long-term? (Finding #9)
}

export interface DecisionResult {
  pattern: AuthPatternType;
  label: string;
  explanation: string;
}
