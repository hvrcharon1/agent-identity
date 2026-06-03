/**
 * types.ts — AgentAuthMdStore type definitions
 *
 * Interfaces for the auth.md registration protocol:
 *   - ProtectedResourceMetadata (RFC 9728 §3)
 *   - AuthServerMetadata / AgentAuthBlock (auth.md spec)
 *   - AgentAuthMdConfig (per-slot configuration)
 *   - IdJagProvider (caller-supplied ID-JAG minter)
 *   - AgentAuthMdStoreOptions (constructor arg)
 */

/** One registration method supported by a target service. */
export type AgentAuthMdMethod =
  | 'id-jag'         // ID-JAG JWT assertion — requires idJagProvider
  | 'verified-email' // email + OTP claim ceremony
  | 'anonymous';     // no user identity; optional claim later

/** Protected Resource Metadata (RFC 9728 §3) */
export interface ProtectedResourceMetadata {
  resource: string;
  resource_name?: string;
  resource_logo_uri?: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}

/** The agent_auth block from the AS metadata response. */
export interface AgentAuthBlock {
  skill?: string;
  register_uri: string;
  claim_uri?: string;
  revocation_uri?: string;
  identity_types_supported: string[];
  anonymous?: { credential_types_supported: string[] };
  identity_assertion?: {
    assertion_types_supported: string[];
    credential_types_supported: string[];
  };
  events_supported?: string[];
}

/** Authorization Server Metadata containing the agent_auth block. */
export interface AuthServerMetadata {
  resource?: string;
  authorization_servers?: string[];
  agent_auth: AgentAuthBlock;
}

/**
 * Configuration for one auth.md-backed credential slot.
 * One AgentAuthMdConfig entry per downstream service you want to register with.
 */
export interface AgentAuthMdConfig {
  /** The ref string that CredentialRouter uses to look this entry up. */
  ref: string;
  kind: 'fixed' | 'user-delegated';
  name: string;
  scope: string;
  status: 'active' | 'pending' | 'revoked';
  provider?: string;
  tags?: string[];

  /** Base URL of the service's resource server, e.g. https://api.service.com */
  resourceServerUrl: string;

  /**
   * Registration method preference order. The store tries each in order and
   * uses the first one the service's agent_auth block supports.
   * Default: ['id-jag', 'verified-email', 'anonymous']
   */
  methodPreference?: AgentAuthMdMethod[];

  /**
   * Required when method='id-jag'. Called to mint a fresh ID-JAG for the
   * given audience. Must return a compact JWT string or null if unavailable.
   */
  idJagProvider?: IdJagProvider;

  /**
   * Required when method='verified-email'. The email address to assert.
   */
  userEmail?: string;

  /**
   * Proactive refresh buffer in ms (default 30 000 = 30 s).
   * Token is re-registered when cached expiry is within this window.
   */
  expiryBufferMs?: number;
}

/** Supplies an audience-bound ID-JAG JWT for a given resource URL. */
export interface IdJagProvider {
  /** Returns a signed compact JWT or null if not available for this audience. */
  mintForAudience(audience: string): Promise<string | null>;
}

/** Constructor options for AgentAuthMdStore. */
export interface AgentAuthMdStoreOptions {
  configs: AgentAuthMdConfig[];
  /** Inject a custom fetch implementation (useful for testing). Default: globalThis.fetch */
  fetchFn?: typeof globalThis.fetch;
}

/** Internal registration response shape (minimal union of id-jag + anonymous paths). */
export interface RegistrationResponse {
  access_token?: string;
  credential_token?: string;
  api_key?: string;
  expires_in?: number;
  claim_token?: string;
  scopes?: string[];
  post_claim_scopes?: string[];
}

/** Internal claim ceremony response shape. */
export interface ClaimCeremonyResponse {
  credential_token?: string;
  access_token?: string;
  api_key?: string;
  expires_in?: number;
}
