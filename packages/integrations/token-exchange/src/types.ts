/**
 * RFC 8693 OAuth 2.0 Token Exchange — types for @datacules/agent-identity-token-exchange.
 *
 * RFC reference: https://datatracker.ietf.org/doc/html/rfc8693
 */
import type { CredentialKind, CredentialStatus } from '@datacules/agent-identity';

// ─── RFC 8693 token type URNs ────────────────────────────────────────────────

export const RFC_TOKEN_TYPES = {
  /** OAuth 2.0 access token */
  ACCESS_TOKEN:  'urn:ietf:params:oauth:token-type:access_token',
  /** OAuth 2.0 refresh token */
  REFRESH_TOKEN: 'urn:ietf:params:oauth:token-type:refresh_token',
  /** OpenID Connect ID token */
  ID_TOKEN:      'urn:ietf:params:oauth:token-type:id_token',
  /** SAML 1.1 assertion */
  SAML1:         'urn:ietf:params:oauth:token-type:saml1',
  /** SAML 2.0 assertion */
  SAML2:         'urn:ietf:params:oauth:token-type:saml2',
  /** JSON Web Token */
  JWT:           'urn:ietf:params:oauth:token-type:jwt',
} as const;

export type RfcTokenType = typeof RFC_TOKEN_TYPES[keyof typeof RFC_TOKEN_TYPES];

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Defines one "exchange slot" — a downstream service that requires its own
 * scoped token obtained by exchanging the user's existing access/ID token.
 *
 * The `ref` field acts as the credentialRef in your RoutingRule.
 * TokenExchangeStore.findByRef(ref) exchanges the user's subject token
 * and returns a Credential whose ref IS the exchanged access_token.
 */
export interface TokenExchangeConfig {
  /**
   * Unique slot identifier — must match the `credentialRef` on the RoutingRule
   * that routes requests to this exchange configuration.
   */
  ref: string;

  /** Human-readable name (shown in dashboards and audit logs) */
  name: string;

  kind: CredentialKind;

  /**
   * Human-readable scope description (e.g. "crm:read crm:write").
   * Also used by validateForMigration() scope checks when set.
   */
  scope: string;

  status: CredentialStatus;

  /** Provider hint (e.g. 'openai') — propagated to returned Credential.provider */
  provider?: string;

  /**
   * Optional tags for compliance report filtering
   * (e.g. ['pii', 'financial', 'prod']).
   */
  tags?: string[];

  // ─── RFC 8693 endpoint configuration ──────────────────────────────────────

  /**
   * Full URL of the OAuth 2.0 token endpoint.
   *
   * Examples:
   *   Keycloak:  https://auth.example.com/realms/acme/protocol/openid-connect/token
   *   Auth0:     https://acme.us.auth0.com/oauth/token
   *   Azure AD:  https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
   *   Okta:      https://acme.okta.com/oauth2/v1/token
   */
  tokenEndpoint: string;

  /** OAuth 2.0 client_id for the token exchange request */
  clientId: string;

  /**
   * OAuth 2.0 client_secret.
   * Omit when using client assertion (PKCE / private_key_jwt) or
   * when the client is public — in those cases pass the assertion
   * via extraParams.
   */
  clientSecret?: string;

  /**
   * Scopes to request for the exchanged token.
   * Sent as a space-separated `scope` parameter.
   *
   * @example ['crm:read', 'crm:write']
   */
  requestedScopes: string[];

  /**
   * `audience` parameter — identifies the intended recipient of the
   * exchanged token (typically the downstream service base URL).
   *
   * @example 'https://crm.example.com'
   */
  audience?: string;

  /**
   * Token type of the subject_token being presented.
   * Default: RFC_TOKEN_TYPES.ACCESS_TOKEN
   */
  subjectTokenType?: RfcTokenType;

  /**
   * Token type to request from the AS.
   * Default: RFC_TOKEN_TYPES.ACCESS_TOKEN
   */
  requestedTokenType?: RfcTokenType;

  /**
   * Additional form parameters to include in the token exchange request.
   * Use for AS-specific extensions:
   *   Keycloak: { requested_issuer: 'external-idp' }
   *   Azure:    { requested_subject: userId }
   */
  extraParams?: Record<string, string>;
}

// ─── RFC 8693 wire types ─────────────────────────────────────────────────────

/** Successful RFC 8693 token exchange response body */
export interface TokenExchangeResponse {
  /** The newly issued token */
  access_token: string;
  /** Identifies the type of token issued */
  issued_token_type: RfcTokenType;
  /** Always 'Bearer' for access tokens */
  token_type: string;
  /** Lifetime in seconds — used to compute Credential.expiresAt */
  expires_in?: number;
  /** Space-separated granted scopes (may differ from requested) */
  scope?: string;
}

// ─── SubjectTokenProvider ────────────────────────────────────────────────────

/**
 * Provides the subject token (the user's existing access/ID token) for a
 * given credential ref. Called by TokenExchangeStore on every cache miss.
 *
 * Implement this as a closure over your request context so the store
 * always uses the token for the current request's authenticated user:
 *
 * @example
 * ```typescript
 * // In your Next.js API route:
 * const subjectToken = req.headers.authorization?.replace('Bearer ', '');
 * const provider: SubjectTokenProvider = async (_ref) => subjectToken ?? null;
 * const store = new TokenExchangeStore({ configs, subjectTokenProvider: provider });
 * ```
 *
 * Returning null causes findByRef() to return null (credential unresolved)
 * without throwing — safe for anonymous or service-to-service requests.
 */
export type SubjectTokenProvider = (credentialRef: string) => Promise<string | null>;

// ─── Constructor options ─────────────────────────────────────────────────────

export interface TokenExchangeStoreOptions {
  /** One entry per downstream service that requires an exchanged token */
  configs: TokenExchangeConfig[];

  /**
   * Called on every cache miss to obtain the user's current subject token.
   * Implement as a closure over your request context.
   */
  subjectTokenProvider: SubjectTokenProvider;

  /**
   * Override the global fetch function used for token exchange HTTP requests.
   * Useful in tests to avoid live AS calls:
   *   fetchFn: vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse })
   */
  fetchFn?: typeof globalThis.fetch;
}
