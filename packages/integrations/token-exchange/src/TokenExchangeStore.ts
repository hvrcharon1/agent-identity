/**
 * TokenExchangeStore — RFC 8693 OAuth 2.0 Token Exchange CredentialStore.
 *
 * Implements the @datacules/agent-identity CredentialStore interface.
 * On findByRef() it exchanges the caller's existing access/ID token for a
 * scoped token at the configured Authorization Server, caches the result
 * until 30 seconds before expiry, and returns a Credential whose ref IS
 * the exchanged access_token (ready for server-side injection).
 *
 * This store is designed to be created per-request (lightweight, no SDK
 * dependencies) or as a long-lived singleton with a request-scoped
 * SubjectTokenProvider closure.
 *
 * See README.md for usage examples with Keycloak, Auth0, Azure AD, and Okta.
 */
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';
import {
  type TokenExchangeConfig,
  type TokenExchangeResponse,
  type SubjectTokenProvider,
  type TokenExchangeStoreOptions,
  RFC_TOKEN_TYPES,
} from './types';

/** Internal cache entry — holds the exchanged token and its Unix expiry (ms) */
interface CacheEntry {
  exchangedToken: string;
  expiresAt: number;
}

export class TokenExchangeStore implements CredentialStore {
  private readonly configMap = new Map<string, TokenExchangeConfig>();
  private readonly cache     = new Map<string, CacheEntry>();
  private readonly fetchFn:   typeof globalThis.fetch;
  private readonly provider:  SubjectTokenProvider;

  /**
   * Proactive refresh buffer (ms). When the cached token expires within
   * this window, the store treats it as a cache miss and re-exchanges,
   * preventing downstream services from receiving a nearly-expired token.
   */
  private static readonly EXPIRY_BUFFER_MS = 30_000;

  constructor(options: TokenExchangeStoreOptions) {
    for (const cfg of options.configs) {
      this.configMap.set(cfg.ref, cfg);
    }
    this.fetchFn  = options.fetchFn ?? globalThis.fetch;
    this.provider = options.subjectTokenProvider;
  }

  // ─── CredentialStore interface ─────────────────────────────────────────────

  /**
   * Resolves a token-exchange credential by ref.
   *
   * Steps:
   *   1. Looks up the TokenExchangeConfig registered for `ref`.
   *   2. Returns the cached exchanged token if it is still fresh.
   *   3. Calls subjectTokenProvider(ref) to obtain the user's current token.
   *   4. POSTs an RFC 8693 token exchange request to the AS token endpoint.
   *   5. Caches the returned access_token and returns a Credential.
   *
   * Returns null (without throwing) when:
   *   - `ref` is not registered / config status is not 'active'
   *   - subjectTokenProvider returns null (unauthenticated caller)
   *   - The AS returns a non-2xx response
   *   - The fetch call throws (network error, DNS failure)
   */
  async findByRef(ref: string): Promise<Credential | null> {
    const cfg = this.configMap.get(ref);
    if (!cfg || cfg.status !== 'active') return null;

    // ── Cache hit ────────────────────────────────────────────────────────────
    const cached = this.cache.get(ref);
    if (cached && cached.expiresAt > Date.now() + TokenExchangeStore.EXPIRY_BUFFER_MS) {
      return this.toCredential(cfg, cached.exchangedToken, new Date(cached.expiresAt).toISOString());
    }

    // ── Subject token ────────────────────────────────────────────────────────
    const subjectToken = await this.provider(ref);
    if (!subjectToken) return null;

    // ── RFC 8693 form body ───────────────────────────────────────────────────
    const params: Record<string, string> = {
      grant_type:         'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id:          cfg.clientId,
      subject_token:      subjectToken,
      subject_token_type: cfg.subjectTokenType ?? RFC_TOKEN_TYPES.ACCESS_TOKEN,
    };

    if (cfg.clientSecret)                  params.client_secret        = cfg.clientSecret;
    if (cfg.requestedTokenType)            params.requested_token_type = cfg.requestedTokenType;
    if (cfg.requestedScopes.length > 0)    params.scope                = cfg.requestedScopes.join(' ');
    if (cfg.audience)                      params.audience             = cfg.audience;
    if (cfg.extraParams)                   Object.assign(params, cfg.extraParams);

    // ── Token exchange request ───────────────────────────────────────────────
    try {
      const resp = await this.fetchFn(cfg.tokenEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams(params).toString(),
      });

      if (!resp.ok) return null;

      const data = await resp.json() as TokenExchangeResponse;

      // Default TTL: 1 hour when expires_in is absent (non-compliant AS)
      const ttlMs    = (data.expires_in ?? 3600) * 1000;
      const expiresAt = Date.now() + ttlMs;

      this.cache.set(ref, { exchangedToken: data.access_token, expiresAt });

      return this.toCredential(cfg, data.access_token, new Date(expiresAt).toISOString());
    } catch {
      // Network error, JSON parse failure, etc. — return null, do not throw.
      return null;
    }
  }

  async listActive(): Promise<Credential[]> {
    return Array.from(this.configMap.values())
      .filter(c => c.status === 'active')
      .map(c => this.toCredential(c, c.ref));
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    return (await this.listActive()).filter(c => c.kind === kind);
  }

  // ─── Cache management ──────────────────────────────────────────────────────

  /**
   * Invalidate the cached exchanged token for a specific credential ref.
   * The next findByRef() call will re-exchange the subject token.
   *
   * Call this when:
   *   - The downstream service returns 401 with the cached token
   *   - You know the user's upstream token has been refreshed
   *   - You need to force re-scoping (scope change in config)
   */
  invalidateCache(ref: string): void {
    this.cache.delete(ref);
  }

  /**
   * Flush all cached exchanged tokens.
   * All subsequent findByRef() calls will re-exchange subject tokens.
   * Use in test teardown or after a full re-authentication event.
   */
  flushCache(): void {
    this.cache.clear();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private toCredential(
    cfg: TokenExchangeConfig,
    ref: string,
    expiresAt?: string
  ): Credential {
    return {
      id:        `token-exchange:${cfg.ref}`,
      kind:      cfg.kind,
      name:      cfg.name,
      scope:     cfg.scope,
      status:    cfg.status,
      provider:  cfg.provider,
      ref,
      expiresAt,
      tags:      cfg.tags,
    };
  }
}
