/**
 * AgentAuthMdStore — auth.md registration CredentialStore (v0.6.0 aligned)
 *
 * Implements @datacules/agent-identity's CredentialStore interface.
 * On findByRef() it:
 *   1. Checks the local token cache (returns early if fresh).
 *   2. Discovers the service's agent_auth block via RFC 9728 PRM discovery.
 *   3. Selects the best registration method from the caller's preference list.
 *   4. Runs the appropriate registration flow (ID-JAG, service-auth, anonymous).
 *   5. For ID-JAG: exchanges the service-signed identity_assertion at
 *      /oauth2/token (jwt-bearer grant) for an access_token.
 *   6. For service-auth/anonymous: stores pending claim state for ceremony polling.
 *   7. Caches the resulting credential and returns it.
 *
 * Returns null (never throws) on any non-2xx HTTP response or network error.
 *
 * Upstream alignment (workos/auth.md v0.6.0)
 * ──────────────────────────────────────────
 * - Discovery: accepts both new (identity_endpoint) and old (register_uri) field names
 * - Registration: no longer sends requested_credential_type
 * - ID-JAG: handles 401 interaction_required (step-up) and login_required (stale auth_time)
 * - Token exchange: identity_assertion from registration → /oauth2/token jwt-bearer grant
 * - Claim ceremony: RFC 8628-shaped user_code + verification_uri; polls /oauth2/token
 *   with urn:workos:agent-auth:grant-type:claim
 * - service_auth: top-level registration type with login_hint body
 * - verified-email: removed from spec; kept as legacy fallback for pre-v0.6.0 services
 */
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';
import type {
  AgentAuthMdConfig,
  AgentAuthMdMethod,
  AgentAuthBlock,
  AgentAuthMdStoreOptions,
  RegistrationResponse,
  ClaimCeremonyResponse,
  PendingClaimState,
  CeremonyBlock,
  TokenResponse,
  TokenErrorResponse,
} from './types';
import { resolveIdentityEndpoint, resolveClaimEndpoint } from './types';
import { discoverService } from './discovery';

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheEntry {
  credential: Credential;
  expiresAt: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_BUFFER_MS = 30_000;
const CLAIM_GRANT_TYPE = 'urn:workos:agent-auth:grant-type:claim';
const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const DEFAULT_METHOD_PREFERENCE: AgentAuthMdMethod[] = [
  'id-jag',
  'service-auth',
  'verified-email',
  'anonymous',
];

// ─── AgentAuthMdStore ─────────────────────────────────────────────────────────

export class AgentAuthMdStore implements CredentialStore {
  private readonly configMap = new Map<string, AgentAuthMdConfig>();
  private readonly cache     = new Map<string, CacheEntry>();
  private readonly pending   = new Map<string, PendingClaimState>();
  private fetchFn: typeof globalThis.fetch;

  constructor(options: AgentAuthMdStoreOptions) {
    for (const cfg of options.configs) {
      this.configMap.set(cfg.ref, cfg);
    }
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  // ─── CredentialStore interface ──────────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    const cfg = this.configMap.get(ref);
    if (!cfg || cfg.status !== 'active') return null;

    const expiryBuffer = cfg.expiryBufferMs ?? DEFAULT_EXPIRY_BUFFER_MS;
    const cached = this.cache.get(ref);
    if (cached && cached.expiresAt > Date.now() + expiryBuffer) {
      return cached.credential;
    }

    const discovery = await discoverService(cfg.resourceServerUrl, this.fetchFn);
    if (!discovery) return null;

    const { agentAuth, tokenEndpoint } = discovery;
    const method = this.selectMethod(agentAuth, cfg.methodPreference);
    if (!method) return null;

    switch (method) {
      case 'id-jag':       return this.registerIdJag(cfg, agentAuth, tokenEndpoint);
      case 'service-auth': return this.registerServiceAuth(cfg, agentAuth, tokenEndpoint);
      case 'verified-email': return this.registerVerifiedEmail(cfg, agentAuth, tokenEndpoint);
      case 'anonymous':    return this.registerAnonymous(cfg, agentAuth, tokenEndpoint);
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

  async revokeByIdentity(_issuer: string, _subject: string, _audience: string): Promise<number> {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  // ─── Claim ceremony (v0.6.0: RFC 8628-shaped polling) ─────────────────────

  /**
   * Poll the token endpoint for claim ceremony completion.
   * Returns the credential on success, null if still pending, throws on expiry.
   *
   * v0.6.0 flow: agent polls /oauth2/token with grant_type=urn:workos:agent-auth:grant-type:claim
   * Responses: authorization_pending (keep polling), expired_token (re-initiate), success.
   */
  async pollClaimCeremony(ref: string): Promise<Credential | null> {
    const claim = this.pending.get(ref);
    if (!claim || !claim.tokenEndpoint) return null;

    const cfg = this.configMap.get(ref);
    if (!cfg) return null;

    try {
      const resp = await this.fetchFn(claim.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: CLAIM_GRANT_TYPE,
          claim_token: claim.claimToken,
        }).toString(),
      });

      if (!resp.ok) {
        const err = await resp.json() as TokenErrorResponse;
        if (err.error === 'authorization_pending') return null;
        if (err.error === 'expired_token') {
          throw new Error(`AgentAuthMdStore: claim ceremony expired for ref '${ref}'. Re-initiate via findByRef().`);
        }
        return null;
      }

      const data = await resp.json() as TokenResponse;
      const credential = this.cacheAndReturn(cfg, data.access_token, data.expires_in, 'active');
      credential.claimedAt = new Date().toISOString();

      if (data.identity_assertion) {
        credential.identityAssertion = data.identity_assertion;
      }

      this.pending.delete(ref);
      return credential;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('AgentAuthMdStore:')) throw err;
      return null;
    }
  }

  /**
   * Get the pending ceremony info for a ref (user_code, verification_uri, etc).
   * Returns null if no pending claim exists.
   */
  getPendingCeremony(ref: string): CeremonyBlock | null {
    return this.pending.get(ref)?.ceremony ?? null;
  }

  // ─── Legacy claim ceremony (OTP path — pre-v0.4.0 compat) ─────────────────

  async startClaimCeremony(ref: string, email?: string): Promise<string> {
    const claim = this.pending.get(ref);
    if (!claim) {
      throw new Error(
        `AgentAuthMdStore: no pending claim for ref '${ref}'. ` +
        `Call findByRef() with a 'service-auth', 'verified-email', or 'anonymous' config first.`
      );
    }

    const body: Record<string, string> = { claim_token: claim.claimToken };
    if (email) body.email = email;

    try {
      const resp = await this.fetchFn(claim.claimEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`AgentAuthMdStore: startClaimCeremony failed HTTP ${resp.status}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('AgentAuthMdStore:')) throw err;
      throw new Error('AgentAuthMdStore: startClaimCeremony network error');
    }

    return claim.claimToken;
  }

  async completeClaimCeremony(ref: string, otp: string): Promise<Credential | null> {
    const claim = this.pending.get(ref);
    if (!claim) return null;

    const cfg = this.configMap.get(ref);
    if (!cfg) return null;

    try {
      const resp = await this.fetchFn(claim.claimEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_token: claim.claimToken, otp }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as ClaimCeremonyResponse;
      const token = data.credential_token ?? data.access_token ?? data.api_key;
      if (!token) return null;

      const ttlMs = (data.expires_in ?? 3600) * 1000;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      const credential = this.toCredential(cfg, token, expiresAt, 'active');
      credential.claimedAt = new Date().toISOString();

      this.cache.set(ref, { credential, expiresAt: Date.now() + ttlMs });
      this.pending.delete(ref);

      return credential;
    } catch {
      return null;
    }
  }

  // ─── Cache management ─────────────────────────────────────────────────────

  invalidateCache(ref: string): void {
    this.cache.delete(ref);
  }

  flushCache(): void {
    this.cache.clear();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private selectMethod(
    block: AgentAuthBlock,
    preference?: AgentAuthMdMethod[]
  ): AgentAuthMdMethod | null {
    const pref = preference ?? DEFAULT_METHOD_PREFERENCE;
    const supported = new Set<AgentAuthMdMethod>();

    for (const t of block.identity_types_supported) {
      switch (t) {
        case 'id-jag':
        case 'urn:ietf:params:oauth:token-type:id-jag':
          supported.add('id-jag');
          break;

        case 'verified_email':
        case 'verified-email':
          supported.add('verified-email');
          break;

        case 'anonymous':
          supported.add('anonymous');
          break;

        case 'service_auth':
        case 'service-auth':
          supported.add('service-auth');
          break;

        case 'identity_assertion': {
          const ia = block.identity_assertion;
          if (ia?.assertion_types_supported) {
            for (const at of ia.assertion_types_supported) {
              if (
                at === 'urn:ietf:params:oauth:token-type:id-jag' ||
                at === 'id-jag'
              ) {
                supported.add('id-jag');
              } else if (at === 'verified_email' || at === 'verified-email') {
                supported.add('verified-email');
              }
            }
          }
          break;
        }
      }
    }

    if (block.anonymous) supported.add('anonymous');

    for (const m of pref) {
      if (supported.has(m)) return m;
    }
    return null;
  }

  /**
   * ID-JAG registration flow (v0.6.0):
   * 1. POST assertion to identity_endpoint
   * 2. On 200: receive identity_assertion → exchange at /oauth2/token
   * 3. On 401 interaction_required: store ceremony for step-up, return null
   * 4. On 401 login_required: return null (caller must re-authenticate upstream)
   */
  private async registerIdJag(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock,
    tokenEndpoint?: string
  ): Promise<Credential | null> {
    if (!cfg.idJagProvider) return null;

    const assertion = await cfg.idJagProvider.mintForAudience(cfg.resourceServerUrl);
    if (!assertion) return null;

    const identityEndpoint = resolveIdentityEndpoint(block);
    if (!identityEndpoint) return null;

    try {
      const resp = await this.fetchFn(identityEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'identity_assertion',
          assertion_type: 'urn:ietf:params:oauth:token-type:id-jag',
          assertion,
        }),
      });

      if (resp.status === 401) {
        const errData = await resp.json() as RegistrationResponse;
        if (errData.error === 'interaction_required' && errData.claim_token) {
          const claimEndpoint = resolveClaimEndpoint(block) ?? errData.claim_url ?? '';
          this.pending.set(cfg.ref, {
            claimEndpoint,
            claimToken: errData.claim_token,
            tokenEndpoint,
            ceremony: errData.claim,
          });
          return null;
        }
        // login_required — caller needs to re-authenticate upstream
        return null;
      }

      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;

      // v0.6.0: exchange identity_assertion at /oauth2/token
      if (data.identity_assertion && tokenEndpoint) {
        return this.exchangeAssertion(cfg, data.identity_assertion, tokenEndpoint);
      }

      // Fallback: pre-v0.2.0 servers may return access_token directly
      const token = data.access_token ?? data.credential_token;
      if (!token) return null;

      return this.cacheAndReturn(cfg, token, data.expires_in, 'active');
    } catch {
      return null;
    }
  }

  /**
   * Exchange a service-signed identity_assertion at /oauth2/token using
   * the RFC 7523 jwt-bearer grant.
   */
  private async exchangeAssertion(
    cfg: AgentAuthMdConfig,
    identityAssertion: string,
    tokenEndpoint: string
  ): Promise<Credential | null> {
    try {
      const resp = await this.fetchFn(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: JWT_BEARER_GRANT_TYPE,
          assertion: identityAssertion,
        }).toString(),
      });

      if (!resp.ok) return null;

      const data = await resp.json() as TokenResponse;
      const credential = this.cacheAndReturn(cfg, data.access_token, data.expires_in, 'active');
      credential.identityAssertion = identityAssertion;
      return credential;
    } catch {
      return null;
    }
  }

  /**
   * service_auth registration (v0.6.0):
   * Sends { type: 'service_auth', login_hint } to identity_endpoint.
   * Returns null — caller must poll via pollClaimCeremony() or legacy OTP path.
   */
  private async registerServiceAuth(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock,
    tokenEndpoint?: string
  ): Promise<Credential | null> {
    if (!cfg.userEmail) return null;

    const identityEndpoint = resolveIdentityEndpoint(block);
    if (!identityEndpoint) return null;

    try {
      const resp = await this.fetchFn(identityEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'service_auth',
          login_hint: cfg.userEmail,
        }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;

      if (data.claim_token) {
        const claimEndpoint = resolveClaimEndpoint(block) ?? data.claim_url ?? '';
        this.pending.set(cfg.ref, {
          claimEndpoint,
          claimToken: data.claim_token,
          tokenEndpoint,
          ceremony: data.claim,
        });
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Legacy verified-email registration (pre-v0.6.0 services).
   * Kept for backward compatibility with servers that haven't adopted service_auth.
   */
  private async registerVerifiedEmail(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock,
    tokenEndpoint?: string
  ): Promise<Credential | null> {
    if (!cfg.userEmail) return null;

    const identityEndpoint = resolveIdentityEndpoint(block);
    if (!identityEndpoint) return null;

    try {
      const resp = await this.fetchFn(identityEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'identity_assertion',
          assertion_type: 'verified_email',
          assertion: cfg.userEmail,
        }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;

      if (data.claim_token) {
        const claimEndpoint = resolveClaimEndpoint(block) ?? data.claim_url ?? '';
        this.pending.set(cfg.ref, {
          claimEndpoint,
          claimToken: data.claim_token,
          tokenEndpoint,
          ceremony: data.claim,
        });
      }

      return null;
    } catch {
      return null;
    }
  }

  private async registerAnonymous(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock,
    tokenEndpoint?: string
  ): Promise<Credential | null> {
    const identityEndpoint = resolveIdentityEndpoint(block);
    if (!identityEndpoint) return null;

    try {
      const resp = await this.fetchFn(identityEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'anonymous' }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;

      // v0.6.0: anonymous gets identity_assertion → exchange
      if (data.identity_assertion && tokenEndpoint) {
        const credential = await this.exchangeAssertion(cfg, data.identity_assertion, tokenEndpoint);
        if (credential) {
          credential.status = 'unclaimed';
          if (data.pre_claim_scopes) credential.preClaimScopes = data.pre_claim_scopes;
          if (data.post_claim_scopes) credential.postClaimScopes = data.post_claim_scopes;

          if (data.claim_token) {
            const claimEndpoint = resolveClaimEndpoint(block) ?? data.claim_url ?? '';
            this.pending.set(cfg.ref, {
              claimEndpoint,
              claimToken: data.claim_token,
              tokenEndpoint,
              ceremony: data.claim,
            });
            credential.claimToken = data.claim_token;
          }

          const entry = this.cache.get(cfg.ref);
          if (entry) entry.credential = credential;
          return credential;
        }
      }

      // Fallback: pre-v0.2.0 servers return api_key/access_token directly
      const token = data.api_key ?? data.credential_token ?? data.access_token;
      if (!token) return null;

      const credential = this.cacheAndReturn(cfg, token, data.expires_in, 'unclaimed');

      if (data.scopes ?? data.pre_claim_scopes) credential.preClaimScopes = data.scopes ?? data.pre_claim_scopes;
      if (data.post_claim_scopes) credential.postClaimScopes = data.post_claim_scopes;

      if (data.claim_token) {
        const claimEndpoint = resolveClaimEndpoint(block) ?? data.claim_url ?? '';
        this.pending.set(cfg.ref, {
          claimEndpoint,
          claimToken: data.claim_token,
          tokenEndpoint,
          ceremony: data.claim,
        });
        credential.claimToken = data.claim_token;
      }

      const entry = this.cache.get(cfg.ref);
      if (entry) entry.credential = credential;

      return credential;
    } catch {
      return null;
    }
  }

  private cacheAndReturn(
    cfg: AgentAuthMdConfig,
    token: string,
    expiresIn: number | undefined,
    status: 'active' | 'unclaimed'
  ): Credential {
    const ttlMs     = (expiresIn ?? 3600) * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const credential = this.toCredential(cfg, token, expiresAt, status);
    this.cache.set(cfg.ref, { credential, expiresAt: Date.now() + ttlMs });
    return credential;
  }

  private toCredential(
    cfg: AgentAuthMdConfig,
    ref: string,
    expiresAt?: string,
    status?: 'active' | 'unclaimed'
  ): Credential {
    return {
      id:       `authmd:${cfg.ref}`,
      kind:      cfg.kind,
      name:      cfg.name,
      scope:     cfg.scope,
      status:    status ?? cfg.status,
      provider:  cfg.provider,
      ref,
      expiresAt,
      tags:      cfg.tags,
    };
  }
}
