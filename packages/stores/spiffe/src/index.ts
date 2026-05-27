/**
 * @datacules/agent-identity-store-spiffe
 *
 * SPIFFE/SPIRE workload identity integration. Each agent workload gets a
 * cryptographic X.509 SVID from a SPIRE agent socket instead of reading
 * static secrets. An SVID is a short-lived certificate that proves the
 * workload's identity — no secrets stored anywhere.
 *
 * SpiffeCredentialStore obtains SVIDs from the local SPIRE agent socket
 * and returns Credential objects whose refs are X.509 SVID bundles.
 * Route on matchSpiffeId pattern in RoutingRule.
 *
 * Usage:
 *   import { SpiffeCredentialStore } from '@datacules/agent-identity-store-spiffe';
 *
 *   const store = new SpiffeCredentialStore({
 *     spireSocketPath: '/run/spire/sockets/agent.sock',
 *     trustDomain: 'acme.com',
 *   });
 *
 *   const rule: RoutingRule = {
 *     id: 'rule-orders-agent',
 *     matchSpiffeId: 'spiffe://acme.com/agent/orders-*',
 *     credentialRef: 'orders-db-slot',
 *     credentialKind: 'fixed',
 *     priority: 90,
 *   };
 */
import type { Credential, CredentialStore, CredentialKind } from '@datacules/agent-identity';

// ─── SVID types ──────────────────────────────────────────────────────────────────

export interface SvidBundle {
  /** SPIFFE ID e.g. 'spiffe://acme.com/agent/orders' */
  spiffeId: string;
  /** PEM-encoded X.509 certificate chain */
  certChainPem: string;
  /** ISO 8601 certificate expiry */
  expiresAt: string;
}

// ─── SPIRE agent client ───────────────────────────────────────────────────────

export interface SpireAgentClient {
  /** Fetch the SVID for the current workload from the SPIRE agent socket */
  fetchSvid(spireSocketPath: string): Promise<SvidBundle>;
}

/**
 * Default SPIRE agent client using the Unix socket Workload API.
 * In production, use the official @spiffe/spiffe-workload-api client.
 * This built-in client provides the same interface for environments
 * where the official SDK isn't available.
 */
export class BuiltinSpireAgentClient implements SpireAgentClient {
  async fetchSvid(spireSocketPath: string): Promise<SvidBundle> {
    // In a real deployment this calls the SPIFFE Workload API gRPC endpoint
    // over the Unix domain socket at spireSocketPath.
    // Here we implement the HTTP-over-Unix-socket variant for environments
    // that expose the SPIRE agent via HTTP rather than gRPC directly.
    const socketUrl = `http://unix:${spireSocketPath}:/v1/svid`;
    const res = await fetch(socketUrl, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`SPIRE agent fetch failed: ${res.status}`);
    const body = await res.json() as {
      svids: [{ spiffe_id: string; x509_svid: string; x509_svid_key: string; bundle: string; hint: string }];
    };
    const svid = body.svids[0];
    // Parse expiry from the PEM certificate (simplified)
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // default 1h
    return {
      spiffeId: svid.spiffe_id,
      certChainPem: svid.x509_svid,
      expiresAt,
    };
  }
}

// ─── SpiffeCredentialStore ───────────────────────────────────────────────────

export interface SpiffeCredentialStoreOptions {
  /** Path to SPIRE agent Unix socket, e.g. '/run/spire/sockets/agent.sock' */
  spireSocketPath: string;
  /** SPIFFE trust domain, e.g. 'acme.com' */
  trustDomain: string;
  /** Custom SPIRE client (default: BuiltinSpireAgentClient) */
  spireClient?: SpireAgentClient;
  /** Renew SVID N seconds before expiry (default: 300) */
  renewBeforeExpireSeconds?: number;
}

export class SpiffeCredentialStore implements CredentialStore {
  private svidCache: { bundle: SvidBundle; fetchedAt: number } | null = null;
  private readonly client: SpireAgentClient;
  private readonly renewBefore: number;

  constructor(private readonly opts: SpiffeCredentialStoreOptions) {
    this.client = opts.spireClient ?? new BuiltinSpireAgentClient();
    this.renewBefore = opts.renewBeforeExpireSeconds ?? 300;
  }

  async findByRef(ref: string): Promise<Credential | null> {
    const svid = await this.getSvid();
    // Ref is the SPIFFE ID pattern or exact SPIFFE ID
    if (!this.matchesRef(ref, svid.spiffeId)) return null;
    return this.svidToCredential(svid);
  }

  async listActive(): Promise<Credential[]> {
    const svid = await this.getSvid();
    return [this.svidToCredential(svid)];
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    if (kind !== 'fixed') return [];
    return this.listActive();
  }

  private async getSvid(): Promise<SvidBundle> {
    const renewMs = this.renewBefore * 1000;
    if (this.svidCache) {
      const expiresAt = new Date(this.svidCache.bundle.expiresAt).getTime();
      if (expiresAt - Date.now() > renewMs) return this.svidCache.bundle;
    }
    const bundle = await this.client.fetchSvid(this.opts.spireSocketPath);
    this.svidCache = { bundle, fetchedAt: Date.now() };
    return bundle;
  }

  private matchesRef(ref: string, spiffeId: string): boolean {
    if (ref === spiffeId) return true;
    // Support glob pattern matching: spiffe://domain/agent/*
    if (ref.endsWith('*')) {
      return spiffeId.startsWith(ref.slice(0, -1));
    }
    return false;
  }

  private svidToCredential(svid: SvidBundle): Credential {
    return {
      id: `spiffe-${svid.spiffeId.replace(/[^a-zA-Z0-9-]/g, '-')}`,
      kind: 'fixed',
      name: `SPIFFE SVID: ${svid.spiffeId}`,
      scope: 'spiffe-workload',
      status: 'active',
      ref: svid.spiffeId,
      expiresAt: svid.expiresAt,
      lastRotated: new Date().toISOString(),
    };
  }
}
