/**
 * HashiCorp Vault KV v2 CredentialStore implementation.
 *
 * Each credential is stored as a JSON object under:
 *   <mountPath>/data/<ref>
 *
 * Example write:
 *   vault kv put secret/agent-identity/linear-service-account-slot \
 *     id=cred-linear kind=fixed scope='All projects' status=active ref=linear-service-account-slot
 *
 * Vault reservation uses a separate KV path for migration locks:
 *   <mountPath>/data/_locks/<ref>
 *
 * Required Vault policy:
 *   path "secret/data/agent-identity/*" { capabilities = ["read", "list"] }
 *   path "secret/data/agent-identity/_locks/*" { capabilities = ["create", "update", "delete", "read"] }
 */
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';

export interface VaultCredentialStoreOptions {
  /** Vault server address e.g. https://vault.example.com */
  address: string;
  /** Vault token or AppRole token */
  token: string;
  /** KV v2 mount path (default: 'secret') */
  mountPath?: string;
  /** Path prefix under mountPath (default: 'agent-identity') */
  prefix?: string;
}

interface VaultKVResponse {
  data: { data: Record<string, unknown> };
}

export class VaultCredentialStore implements CredentialStore {
  private readonly address: string;
  private readonly token: string;
  private readonly mountPath: string;
  private readonly prefix: string;

  constructor(options: VaultCredentialStoreOptions) {
    this.address = options.address.replace(/\/$/, '');
    this.token = options.token;
    this.mountPath = options.mountPath ?? 'secret';
    this.prefix = options.prefix ?? 'agent-identity';
  }

  private get headers(): Record<string, string> {
    return { 'X-Vault-Token': this.token, 'Content-Type': 'application/json' };
  }

  private credPath(ref: string): string {
    return `${this.address}/v1/${this.mountPath}/data/${this.prefix}/${ref}`;
  }

  private lockPath(ref: string): string {
    return `${this.address}/v1/${this.mountPath}/data/${this.prefix}/_locks/${ref}`;
  }

  async findByRef(ref: string): Promise<Credential | null> {
    try {
      const res = await fetch(this.credPath(ref), { headers: this.headers });
      if (!res.ok) return null;
      const body = (await res.json()) as VaultKVResponse;
      const cred = body.data?.data as unknown as Credential;
      return cred?.status === 'active' ? cred : null;
    } catch {
      return null;
    }
  }

  async listActive(): Promise<Credential[]> {
    try {
      const res = await fetch(
        `${this.address}/v1/${this.mountPath}/metadata/${this.prefix}?list=true`,
        { headers: this.headers }
      );
      if (!res.ok) return [];
      const body = await res.json() as { data: { keys: string[] } };
      const keys = body.data?.keys ?? [];
      const creds = await Promise.all(keys.map((k: string) => this.findByRef(k)));
      return creds.filter((c): c is Credential => c !== null);
    } catch {
      return [];
    }
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const all = await this.listActive();
    return all.filter((c) => c.kind === kind);
  }

  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    // Read existing lock
    try {
      const res = await fetch(this.lockPath(ref), { headers: this.headers });
      if (res.ok) {
        const body = (await res.json()) as VaultKVResponse;
        const lock = body.data?.data as unknown as { migrationId: string; expiresAt: number };
        if (lock?.migrationId !== migrationId && lock?.expiresAt > Date.now() / 1000) {
          return false; // held by another migration
        }
      }
    } catch { /* no existing lock */ }

    // Write lock
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    try {
      const res = await fetch(this.lockPath(ref), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ data: { migrationId, expiresAt } }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async release(ref: string, migrationId: string): Promise<void> {
    try {
      const res = await fetch(this.lockPath(ref), { headers: this.headers });
      if (!res.ok) return;
      const body = (await res.json()) as VaultKVResponse;
      const lock = body.data?.data as unknown as { migrationId: string };
      if (lock?.migrationId !== migrationId) return;
      await fetch(`${this.address}/v1/${this.mountPath}/data/${this.prefix}/_locks/${ref}`, {
        method: 'DELETE',
        headers: this.headers,
      });
    } catch { /* idempotent */ }
  }
}
