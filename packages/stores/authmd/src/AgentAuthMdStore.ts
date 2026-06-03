/**
 * AgentAuthMdStore — auth.md registration CredentialStore
 *
 * Implements @datacules/agent-identity's CredentialStore interface.
 * On findByRef() it:
 *   1. Checks the local token cache (returns early if fresh).
 *   2. Discovers the service's agent_auth block via RFC 9728 PRM discovery.
 *   3. Selects the best registration method from the caller's preference list.
 *   4. Runs the appropriate registration flow (ID-JAG, verified-email, anonymous).
 *   5. Caches the resulting credential and returns it.
 *
 * Returns null (never throws) on any non-2xx HTTP response or network error.
 *
 * Pattern mirrors TokenExchangeStore — same cache → refresh → return shape.
 */
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';
import type {
  AgentAuthMdConfig,
  AgentAuthMdMethod,
  AgentAuthBlock,
  AgentAuthMdStoreOptions,
  RegistrationResponse,
  ClaimCeremonyResponse,
} from './types';
import { discoverService } from './discovery';

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheEntry {
  credential: Credential;
  /** Unix timestamp (ms) when the credential expires. */
  expiresAt: number;
}

interface PendingClaim {
  claimUri: string;
  claimToken: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_BUFFER_MS = 30_000;
const DEFAULT_METHOD_PREFERENCE: AgentAuthMdMethod[] = ['id-jag', 'verified-email', 'anonymous'];

// ─── AgentAuthMdStore ─────────────────────────────────────────────────────────

export class AgentAuthMdStore implements CredentialStore {
  private readonly configMap = new Map<string, AgentAuthMdConfig>();
  private readonly cache     = new Map<string, CacheEntry>();
  private readonly pending   = new Map<string, PendingClaim>();
  // Not readonly so tests can swap the fetch implementation via bracket notation
  private fetchFn: typeof globalThis.fetch;

  constructor(options: AgentAuthMdStoreOptions) {
    for (const cfg of options.configs) {
      this.configMap.set(cfg.ref, cfg);
    }
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  // ─── CredentialStore interface ──────────────────────────────────────────────

  /**
   * Find a credential by ref. Runs discovery + registration on cache miss.
   * Returns null (never throws) for unknown refs, inactive configs, discovery
   * failures, and non-2xx registration responses.
   */
  async findByRef(ref: string): Promise<Credential | null> {
    const cfg = this.configMap.get(ref);
    if (!cfg || cfg.status !== 'active') return null;

    // ─ Cache hit ───────────────────────────────────────────────────────────────
    const expiryBuffer = cfg.expiryBufferMs ?? DEFAULT_EXPIRY_BUFFER_MS;
    const cached = this.cache.get(ref);
    if (cached && cached.expiresAt > Date.now() + expiryBuffer) {
      return cached.credential;
    }

    // ─ Discovery ─────────────────────────────────────────────────────────────
    const agentAuthBlock = await discoverService(cfg.resourceServerUrl, this.fetchFn);
    if (!agentAuthBlock) return null;

    // ─ Method selection ──────────────────────────────────────────────────────
    const method = this.selectMethod(agentAuthBlock, cfg.methodPreference);
    if (!method) return null;

    // ─ Registration dispatch ──────────────────────────────────────────────
    switch (method) {
      case 'id-jag':         return this.registerIdJag(cfg, agentAuthBlock);
      case 'verified-email': return this.registerVerifiedEmail(cfg, agentAuthBlock);
      case 'anonymous':      return this.registerAnonymous(cfg, agentAuthBlock);
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

  /**
   * Revoke all cached credentials (conservative: clears entire cache).
   * Called when a logout+jwt is received at the revocation_uri endpoint.
   */
  async revokeByIdentity(_issuer: string, _subject: string, _audience: string): Promise<number> {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  // ─── Claim ceremony ────────────────────────────────────────────────────────

  /**
   * Begins the OTP claim ceremony for a pending verified-email or anonymous
   * registration. Returns the claim_token. Throws if no pending claim exists.
   */
  async startClaimCeremony(ref: string, email?: string): Promise<string> {
    const claim = this.pending.get(ref);
    if (!claim) {
      throw new Error(
        `AgentAuthMdStore: no pending claim for ref '${ref}'. ` +
        `Call findByRef() with a 'verified-email' or 'anonymous' config first.`
      );
    }

    const body: Record<string, string> = { claim_token: claim.claimToken };
    if (email) body.email = email;

    try {
      const resp = await this.fetchFn(claim.claimUri, {
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

  /**
   * Submits the OTP to complete the claim ceremony.
   * On success: caches the final credential with status='active', clears
   * the pending entry, sets claimedAt.
   * Returns null (never throws) on non-2xx responses or missing claim state.
   */
  async completeClaimCeremony(ref: string, otp: string): Promise<Credential | null> {
    const claim = this.pending.get(ref);
    if (!claim) return null;

    const cfg = this.configMap.get(ref);
    if (!cfg) return null;

    try {
      const resp = await this.fetchFn(claim.claimUri, {
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

  /** Invalidate the cached token for a specific ref (forces re-registration next call). */
  invalidateCache(ref: string): void {
    this.cache.delete(ref);
  }

  /** Flush all cached tokens. */
  flushCache(): void {
    this.cache.clear();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private selectMethod(
    block: AgentAuthBlock,
    preference?: AgentAuthMdMethod[]
  ): AgentAuthMdMethod | null {
    const pref = preference ?? DEFAULT_METHOD_PREFERENCE;

    // Build the supported set from identity_types_supported + presence of anonymous
    const supported = new Set<AgentAuthMdMethod>();
    for (const t of block.identity_types_supported) {
      if (t === 'id-jag' || t === 'urn:ietf:params:oauth:token-type:id-jag') supported.add('id-jag');
      else if (t === 'verified_email' || t === 'verified-email')              supported.add('verified-email');
      else if (t === 'anonymous')                                              supported.add('anonymous');
    }
    if (block.anonymous) supported.add('anonymous');

    for (const m of pref) {
      if (supported.has(m)) return m;
    }
    return null;
  }

  private async registerIdJag(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock
  ): Promise<Credential | null> {
    if (!cfg.idJagProvider) return null;

    const assertion = await cfg.idJagProvider.mintForAudience(cfg.resourceServerUrl);
    if (!assertion) return null;

    try {
      const resp = await this.fetchFn(block.register_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'identity_assertion',
          assertion_type: 'urn:ietf:params:oauth:token-type:id-jag',
          assertion,
          requested_credential_type: 'access_token',
        }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;
      const token = data.access_token ?? data.credential_token;
      if (!token) return null;

      return this.cacheAndReturn(cfg, token, data.expires_in, 'active');
    } catch {
      return null;
    }
  }

  private async registerVerifiedEmail(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock
  ): Promise<Credential | null> {
    if (!cfg.userEmail) return null;

    try {
      const resp = await this.fetchFn(block.register_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'identity_assertion',
          assertion_type: 'verified_email',
          assertion: cfg.userEmail,
          requested_credential_type: 'api_key',
        }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;

      // Store claim info for the OTP ceremony
      if (data.claim_token && block.claim_uri) {
        this.pending.set(cfg.ref, {
          claimUri: block.claim_uri,
          claimToken: data.claim_token,
        });
      }

      // Spec: verified-email returns null until claim ceremony completes
      return null;
    } catch {
      return null;
    }
  }

  private async registerAnonymous(
    cfg: AgentAuthMdConfig,
    block: AgentAuthBlock
  ): Promise<Credential | null> {
    try {
      const resp = await this.fetchFn(block.register_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'anonymous',
          requested_credential_type: 'api_key',
        }),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as RegistrationResponse;
      const token = data.api_key ?? data.credential_token ?? data.access_token;
      if (!token) return null;

      const credential = this.cacheAndReturn(cfg, token, data.expires_in, 'unclaimed');

      // Annotate with pre/post claim scopes
      if (data.scopes)            credential.preClaimScopes  = data.scopes;
      if (data.post_claim_scopes) credential.postClaimScopes = data.post_claim_scopes;

      // Store claim info for later OTP ceremony
      if (data.claim_token && block.claim_uri) {
        this.pending.set(cfg.ref, {
          claimUri: block.claim_uri,
          claimToken: data.claim_token,
        });
        // Expose claim_token on the credential (in-memory only; never serialised)
        credential.claimToken = data.claim_token;
      }

      // Update cache with annotated credential
      const entry = this.cache.get(cfg.ref);
      if (entry) entry.credential = credential;

      return credential;
    } catch {
      return null;
    }
  }

  /**
   * Cache a credential and return it.
   * `expiresIn` is in seconds (from the registration response).
   */
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
