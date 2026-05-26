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
  /** ISO 8601 — undefined means does not expire */
  expiresAt?: string;
  lastRotated?: string;
  refreshTokenRef?: string;
  rotationIntervalDays?: number;
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
  readOnly?: boolean;
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
}

export interface ResolvedCredential {
  credentialId: string;
  kind: CredentialKind;
  ref: string;
  resolvedFor: string;
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
