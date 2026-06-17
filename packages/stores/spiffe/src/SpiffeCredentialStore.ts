/**
 * @datacules/agent-identity-store-spiffe
 *
 * SPIFFE/SPIRE workload identity credential store.
 *
 * Instead of static credentials stored in a vault, this store uses the
 * SPIFFE Workload API to fetch short-lived X.509 SVIDs (SPIFFE Verifiable
 * Identity Documents) on demand. Each SVID is valid for a configurable TTL
 * (default: 1 hour) and is automatically rotated by the SPIRE agent.
 *
 * How it works:
 *   1. On resolve(), the store looks up a Credential by ref.
 *   2. If the credential is of kind 'spiffe', it calls the Workload API
 *      to fetch the current X.509 SVID bundle for the workload's SPIFFE ID.
 *   3. The SVID's leaf certificate + private key are returned as the
 *      credential ref — downstream services verify the chain against the
 *      trust bundle, not against a static API key.
 *   4. The store caches unexpired SVIDs in memory to avoid Workload API
 *      round-trips on every resolve() call.
 *
 * Zero static secrets at rest — a full store compromise yields only
 * workload metadata, not any usable credential material.
 *
 * Compatible with: SPIRE server, SPIRE agent, any SPIFFE-compliant runtime.
 * Workload API socket: unix:///tmp/spire-agent/public/api.sock (default)
 *                   or SPIFFE_ENDPOINT_SOCKET env var.
 */

import type { Credential, CredentialStore, ResolvedCredential } from '@datacules/agent-identity';

// ─── SVID cache entry ────────────────────────────────────────────────────────

interface SvidCacheEntry {
  ref: string;           // PEM certificate chain (leaf + intermediates)
  expiresAt: Date;
  spiffeId: string;      // spiffe://trust-domain/workload-name
}

// ─── Workload API client interface (lazy-loaded) ─────────────────────────────
// We define only the subset of @spiffe/spiffe-workload-api we need so that
// the package stays an optional peer dep — consumers who don't use SPIFFE
// never need to install it.

interface WorkloadApiClient {
  fetchX509Bundles(): Promise<X509BundlesResponse>;
  fetchX509Svids(): Promise<X509SvidsResponse>;
  close(): void;
}

interface X509SvidsResponse {
  svids: Array<{
    spiffeId: { toString(): string };
    x509Svid: { toString(): string };    // PEM cert chain
    x509SvidKey: { toString(): string }; // PEM private key
    bundle: { toString(): string };       // PEM trust bundle
    hint?: string;                        // optional hint matching our ref
  }>;
}

interface X509BundlesResponse {
  bundles: Map<string, { toString(): string }>;
}

// ─── Store options ────────────────────────────────────────────────────────────

export interface SpiffeCredentialStoreOptions {
  /**
   * SPIFFE Workload API endpoint.
   * Defaults to SPIFFE_ENDPOINT_SOCKET env var or
   * unix:///tmp/spire-agent/public/api.sock
   */
  endpointSocket?: string;

  /**
   * Cache SVIDs for up to this many seconds before re-fetching.
   * Should be less than the SVID TTL configured in SPIRE.
   * Default: 3300 (55 minutes — 5 minute buffer before 1h SVID expires).
   */
  cacheTtlSeconds?: number;

  /**
   * Trust domain for SPIFFE IDs (e.g. 'example.org').
   * Used to construct SPIFFE IDs when matching hints.
   */
  trustDomain?: string;

  /**
   * Static credential metadata (id, name, kind, scope, etc.) indexed by ref.
   * The ref is matched against SVID hints to find the right SVID.
   * Credential values (actual secrets) come from the Workload API, not here.
   */
  credentials: Credential[];
}

// ─── SpiffeCredentialStore ────────────────────────────────────────────────────

export class SpiffeCredentialStore implements CredentialStore {
  private readonly options: Required<SpiffeCredentialStoreOptions>;
  private svidCache = new Map<string, SvidCacheEntry>();
  private client: WorkloadApiClient | null = null;
  // Migration reservation map: ref → { migrationId, expiresAt }
  private reservations = new Map<string, { migrationId: string; expiresAt: number }>();

  constructor(options: SpiffeCredentialStoreOptions) {
    this.options = {
      endpointSocket:
        options.endpointSocket ??
        (typeof process !== 'undefined'
          ? process.env['SPIFFE_ENDPOINT_SOCKET'] ?? 'unix:///tmp/spire-agent/public/api.sock'
          : 'unix:///tmp/spire-agent/public/api.sock'),
      cacheTtlSeconds: options.cacheTtlSeconds ?? 3300,
      trustDomain: options.trustDomain ?? 'example.org',
      credentials: options.credentials,
    };
  }

  // ── CredentialStore interface ──────────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    const meta = this.options.credentials.find((c) => c.ref === ref && c.status === 'active');
    if (!meta) return null;

    // Fetch the SVID for this ref (cache hit if not expired)
    const svid = await this.getSvid(ref);
    if (!svid) return null;

    // Return the credential with the SVID PEM as the live ref value.
    // Callers use the ref to authenticate — here it contains the PEM cert chain.
    return {
      ...meta,
      ref: svid.ref,
      expiresAt: svid.expiresAt.toISOString(),
    };
  }

  async listActive(): Promise<Credential[]> {
    return this.options.credentials.filter((c) => c.status === 'active');
  }

  async listByKind(kind: 'fixed' | 'user-delegated'): Promise<Credential[]> {
    return this.options.credentials.filter(
      (c) => c.kind === kind && c.status === 'active'
    );
  }

  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const existing = this.reservations.get(ref);
    const now = Date.now();
    if (existing && existing.expiresAt > now && existing.migrationId !== migrationId) {
      return false; // held by another migration
    }
    this.reservations.set(ref, { migrationId, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  async release(ref: string, migrationId: string): Promise<void> {
    const existing = this.reservations.get(ref);
    if (existing?.migrationId === migrationId) {
      this.reservations.delete(ref);
    }
  }

  // ── Workload API interaction ───────────────────────────────────────────────

  private async getSvid(ref: string): Promise<SvidCacheEntry | null> {
    const cached = this.svidCache.get(ref);
    if (cached && cached.expiresAt > new Date()) return cached;

    try {
      const client = await this.getClient();
      const response = await client.fetchX509Svids();

      // Match SVID by hint (ref) or by spiffeId path segment
      const matched = response.svids.find(
        (s) =>
          s.hint === ref ||
          s.spiffeId.toString().endsWith(`/${ref}`) ||
          s.spiffeId.toString() === `spiffe://${this.options.trustDomain}/${ref}`
      );

      if (!matched) return null;

      const entry: SvidCacheEntry = {
        ref: matched.x509Svid.toString(), // PEM cert chain
        expiresAt: new Date(Date.now() + this.options.cacheTtlSeconds * 1000),
        spiffeId: matched.spiffeId.toString(),
      };

      this.svidCache.set(ref, entry);
      return entry;
    } catch (err) {
      // Workload API unavailable — fail open with null so the router
      // returns 'no credential matched' rather than crashing
      console.error('[SpiffeCredentialStore] Workload API error:', err);
      return null;
    }
  }

  private async getClient(): Promise<WorkloadApiClient> {
    if (this.client) return this.client;

    // Lazy-load the optional peer dep
    try {
      const mod = await import('@spiffe/spiffe-workload-api' as string);
      const WorkloadApiClientClass =
        (mod as { WorkloadApiClient?: new (socket: string) => WorkloadApiClient })
          .WorkloadApiClient;
      if (!WorkloadApiClientClass) throw new Error('WorkloadApiClient not found in module');
      this.client = new WorkloadApiClientClass(this.options.endpointSocket);
      return this.client;
    } catch {
      throw new Error(
        '[SpiffeCredentialStore] @spiffe/spiffe-workload-api is required but not installed. ' +
        'Run: npm install @spiffe/spiffe-workload-api'
      );
    }
  }

  /** Flush the SVID cache — useful in tests or after a known rotation event. */
  flushCache(): void {
    this.svidCache.clear();
  }

  /** Close the Workload API connection. */
  close(): void {
    this.client?.close();
    this.client = null;
  }
}
