/**
 * @datacules/agent-identity-store-dynamic
 *
 * Just-in-time credential provisioning. Credentials don't exist until the
 * agent requests them. Mints a short-lived secret on demand and returns its
 * ref. The upstream system (Vault, AWS, Azure) revokes the secret when the
 * TTL expires — no long-lived static credentials sit in the store at all.
 *
 * Usage:
 *   import { DynamicCredentialStore, VaultDynamicProvisioner } from '@datacules/agent-identity-store-dynamic';
 *
 *   const store = new DynamicCredentialStore({
 *     provisioner: new VaultDynamicProvisioner({
 *       vaultAddr: 'http://vault:8200',
 *       token: process.env.VAULT_TOKEN!,
 *       mount: 'database',
 *       role: 'crm-readonly',
 *       ttl: '30m',
 *     }),
 *   });
 *
 *   const router = createRouterFromStore(store, rules, logger);
 */
import type { Credential, CredentialStore, CredentialKind } from '@datacules/agent-identity';

// ─── Provisioner interface ──────────────────────────────────────────────────────

export interface DynamicProvisioner {
  /** ID that matches the ref prefix used in routing rules, e.g. 'vault-db' */
  id: string;
  /**
   * Mint a new short-lived secret and return a ref (lease ID or ARN) that
   * the router can use to retrieve the actual secret later.
   */
  provision(ref: string): Promise<ProvisionedSecret>;
  /** Revoke a lease/secret early (called on router shutdown) */
  revoke?(leaseId: string): Promise<void>;
}

export interface ProvisionedSecret {
  /** Opaque ref / lease ID — passed to your vault fetch function, never to the model */
  leaseId: string;
  /** ISO 8601 lease expiry */
  expiresAt: string;
  /** The raw secret — kept server-side only, never passed to the model layer */
  secret?: string;
}

// ─── Vault dynamic secrets provisioner ──────────────────────────────────────────

export interface VaultDynamicProvisionerOptions {
  vaultAddr: string;
  token: string;
  /** KV or secrets engine mount path */
  mount: string;
  /** Vault role that defines the secret scope */
  role: string;
  /** Lease duration e.g. '30m', '1h' */
  ttl?: string;
}

export class VaultDynamicProvisioner implements DynamicProvisioner {
  id = 'vault-dynamic';

  constructor(private readonly opts: VaultDynamicProvisionerOptions) {}

  async provision(_ref: string): Promise<ProvisionedSecret> {
    const { vaultAddr, token, mount, role, ttl } = this.opts;
    const url = `${vaultAddr}/v1/${mount}/creds/${role}`;
    const res = await fetch(url, {
      headers: { 'X-Vault-Token': token, ...(ttl ? { 'X-Vault-Wrap-TTL': ttl } : {}) },
    });
    if (!res.ok) throw new Error(`Vault provision failed: ${res.status} ${await res.text()}`);
    const body = await res.json() as { lease_id: string; lease_duration: number; data: Record<string, string> };
    const expiresAt = new Date(Date.now() + body.lease_duration * 1000).toISOString();
    return { leaseId: body.lease_id, expiresAt, secret: JSON.stringify(body.data) };
  }

  async revoke(leaseId: string): Promise<void> {
    const { vaultAddr, token } = this.opts;
    await fetch(`${vaultAddr}/v1/sys/leases/revoke`, {
      method: 'PUT',
      headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lease_id: leaseId }),
    }).catch(console.error);
  }
}

// ─── AWS IAM Roles Anywhere provisioner ───────────────────────────────────────

export interface AwsRolesAnywhereProvisionerOptions {
  profileArn: string;
  roleArn: string;
  trustAnchorArn: string;
  region: string;
  /** Duration in seconds (900–3600) */
  durationSeconds?: number;
  /** Path to certificate PEM for signing */
  certPath?: string;
}

/**
 * Provisions temporary AWS credentials via IAM Roles Anywhere.
 * Requires `aws_signing_helper` or equivalent OIDC-based credential exchange.
 * This implementation calls the Roles Anywhere endpoint directly.
 */
export class AwsRolesAnywhereProvisioner implements DynamicProvisioner {
  id = 'aws-roles-anywhere';

  constructor(private readonly opts: AwsRolesAnywhereProvisionerOptions) {}

  async provision(_ref: string): Promise<ProvisionedSecret> {
    const { durationSeconds = 3600, region, profileArn, roleArn, trustAnchorArn } = this.opts;
    const endpoint = `https://rolesanywhere.${region}.amazonaws.com/sessions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSeconds, profileArn, roleArn, trustAnchorArn }),
    });
    if (!res.ok) throw new Error(`AWS Roles Anywhere provision failed: ${res.status}`);
    const body = await res.json() as { credentialSet: [{ credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: string } }] };
    const creds = body.credentialSet[0].credentials;
    return {
      leaseId: `aws-session-${Date.now()}`,
      expiresAt: creds.expiration,
      secret: JSON.stringify({ accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken }),
    };
  }
}

// ─── DynamicCredentialStore ──────────────────────────────────────────────────────

export interface DynamicCredentialStoreOptions {
  provisioner: DynamicProvisioner;
  /** Cache unexpired leases (default: true) */
  cache?: boolean;
  /** Renew cache entry N seconds before expiry (default: 60) */
  renewBeforeExpireSeconds?: number;
}

export class DynamicCredentialStore implements CredentialStore {
  private readonly leaseCache = new Map<string, { credential: Credential; expiresAt: number }>();

  constructor(private readonly opts: DynamicCredentialStoreOptions) {}

  async findByRef(ref: string): Promise<Credential | null> {
    const cache = this.opts.cache !== false;
    const renew = this.opts.renewBeforeExpireSeconds ?? 60;

    if (cache) {
      const cached = this.leaseCache.get(ref);
      if (cached && cached.expiresAt > Date.now() + renew * 1000) {
        return cached.credential;
      }
    }

    const provisioned = await this.opts.provisioner.provision(ref);
    const credential: Credential = {
      id: `dyn-${provisioned.leaseId}`,
      kind: 'fixed' as CredentialKind,
      name: `Dynamic credential for ${ref}`,
      scope: 'dynamic',
      status: 'active',
      ref: provisioned.leaseId,
      expiresAt: provisioned.expiresAt,
      lastRotated: new Date().toISOString(),
    };

    if (cache) {
      this.leaseCache.set(ref, {
        credential,
        expiresAt: new Date(provisioned.expiresAt).getTime(),
      });
    }

    return credential;
  }

  async listActive(): Promise<Credential[]> {
    const now = Date.now();
    return Array.from(this.leaseCache.values())
      .filter((e) => e.expiresAt > now)
      .map((e) => e.credential);
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const active = await this.listActive();
    return active.filter((c) => c.kind === kind);
  }
}
