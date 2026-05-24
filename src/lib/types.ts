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
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export type ResourceKind = 'shared' | 'personal';

export interface RoutingRule {
  id: string;
  resourceKind: ResourceKind;
  credentialKind: CredentialKind;
  credentialRef: string;
  description: string;
}

// ─── Agent Request Context ───────────────────────────────────────────────────

export interface AgentRequestContext {
  userId: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  action: string;
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
}

// ─── Decision Helper ─────────────────────────────────────────────────────────

export interface DecisionAnswers {
  variableAccess: boolean | null;   // Q1: do users have different access levels?
  mixedResources: boolean | null;   // Q2: both shared and personal resources?
  auditRequired: boolean | null;    // Q3: per-user audit trail needed?
}

export interface DecisionResult {
  pattern: AuthPatternType;
  label: string;
  explanation: string;
}
