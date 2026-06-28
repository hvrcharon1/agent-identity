/**
 * types.ts — AgentAuthMdStore type definitions
 *
 * Interfaces for the auth.md registration protocol (aligned with v0.6.0):
 *   - ProtectedResourceMetadata (RFC 9728 §3)
 *   - AuthServerMetadata / AgentAuthBlock (auth.md spec)
 *   - AgentAuthMdConfig (per-slot configuration)
 *   - IdJagProvider (caller-supplied ID-JAG minter)
 *   - AgentAuthMdStoreOptions (constructor arg)
 *
 * Upstream alignment (workos/auth.md v0.6.0 — merged 2026-06-10)
 * ───────────────────────────────────────────────────────────────
 * Key changes from earlier versions:
 *   - Discovery fields renamed: register_uri → identity_endpoint,
 *     claim_uri → claim_endpoint, revocation_uri → events_endpoint
 *   - Registration returns identity_assertion (not access_token);
 *     agent exchanges at /oauth2/token with jwt-bearer grant
 *   - Claim ceremony uses RFC 8628-shaped user_code + verification_uri;
 *     agent polls /oauth2/token with urn:workos:agent-auth:grant-type:claim
 *   - service_auth is a top-level registration type (login_hint body)
 *   - Revocation uses secevent+jwt (RFC 8935) not logout+jwt
 *   - requested_credential_type removed from all registration bodies
 *   - ID-JAG step-up returns 401 interaction_required with ceremony block
 *   - Stale auth_time returns 401 login_required with max_age
 */

/** One registration method supported by a target service. */
export type AgentAuthMdMethod =
  | 'id-jag'         // ID-JAG JWT assertion — requires idJagProvider
  | 'service-auth'   // service_auth + login_hint (auth.md PR #15)
  | 'verified-email' // legacy: identity_assertion + verified_email
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
  /** v0.6.0+ field name for the registration endpoint. */
  identity_endpoint?: string;
  /** v0.6.0+ field name for the claim ceremony endpoint. */
  claim_endpoint?: string;
  /** v0.6.0+ field name for the SET receiver endpoint. */
  events_endpoint?: string;
  /** @deprecated Pre-v0.2.0 field name — use identity_endpoint. Accepted for compat. */
  register_uri?: string;
  /** @deprecated Pre-v0.2.0 field name — use claim_endpoint. Accepted for compat. */
  claim_uri?: string;
  /** @deprecated Pre-v0.3.0 field name — use events_endpoint. Accepted for compat. */
  revocation_uri?: string;
  identity_types_supported: string[];
  anonymous?: { credential_types_supported: string[] };
  /** Present on pre-v0.6.0 services. id-jag and verified_email are nested here. */
  identity_assertion?: {
    assertion_types_supported: string[];
    credential_types_supported?: string[];
  };
  /** Present on v0.6.0+ services. */
  service_auth?: {
    credential_types_supported?: string[];
  };
  events_supported?: string[];
}

/** Resolves the identity_endpoint from new or old field names. */
export function resolveIdentityEndpoint(block: AgentAuthBlock): string | undefined {
  return block.identity_endpoint ?? block.register_uri;
}

/** Resolves the claim_endpoint from new or old field names. */
export function resolveClaimEndpoint(block: AgentAuthBlock): string | undefined {
  return block.claim_endpoint ?? block.claim_uri;
}

/** Resolves the events_endpoint from new or old field names. */
export function resolveEventsEndpoint(block: AgentAuthBlock): string | undefined {
  return block.events_endpoint ?? block.revocation_uri;
}

/** Authorization Server Metadata containing the agent_auth block (RFC 8414 + auth.md profile). */
export interface AuthServerMetadata {
  resource?: string;
  authorization_servers?: string[];
  issuer?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
  grant_types_supported?: string[];
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
   * Default: ['id-jag', 'service-auth', 'verified-email', 'anonymous']
   */
  methodPreference?: AgentAuthMdMethod[];

  /**
   * Required when method='id-jag'. Called to mint a fresh ID-JAG for the
   * given audience. Must return a compact JWT string or null if unavailable.
   */
  idJagProvider?: IdJagProvider;

  /**
   * Required when method='service-auth' or method='verified-email'.
   * The email address to pass as login_hint (service-auth) or assertion (verified-email).
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

/** Internal registration response shape (minimal union of all registration paths). */
export interface RegistrationResponse {
  registration_id?: string;
  registration_type?: string;
  /** v0.6.0: service-signed identity_assertion JWT (exchange at /oauth2/token). */
  identity_assertion?: string;
  assertion_expires?: string;
  /** Pre-v0.2.0: direct access_token in registration response. */
  access_token?: string;
  credential_token?: string;
  api_key?: string;
  expires_in?: number;
  claim_token?: string;
  claim_token_expires?: string;
  claim_url?: string;
  scopes?: string[];
  pre_claim_scopes?: string[];
  post_claim_scopes?: string[];
  /** v0.6.0: RFC 8628-shaped ceremony block. */
  claim?: CeremonyBlock;
  /** Error responses (401 interaction_required / login_required). */
  error?: string;
  error_description?: string;
  max_age?: number;
}

/** RFC 8628-shaped ceremony block returned with registration or claim responses. */
export interface CeremonyBlock {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** OAuth token endpoint response (jwt-bearer or claim grant). */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  /** Returned by claim grant — refreshable identity_assertion. */
  identity_assertion?: string;
  assertion_expires?: string;
}

/** OAuth token endpoint error response. */
export interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

/** Internal claim ceremony response shape (legacy OTP path). */
export interface ClaimCeremonyResponse {
  credential_token?: string;
  access_token?: string;
  api_key?: string;
  expires_in?: number;
}

/** Pending claim state — tracks ceremony info for polling or OTP completion. */
export interface PendingClaimState {
  claimEndpoint: string;
  claimToken: string;
  tokenEndpoint?: string;
  ceremony?: CeremonyBlock;
  identityAssertion?: string;
}
