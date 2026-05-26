/**
 * Azure Key Vault + Azure Table Storage CredentialStore implementation.
 *
 * Key Vault holds each credential as a secret whose name is the credential ref.
 * The secret value is the JSON-serialised Credential object.
 * The secret's "content-type" tag carries the status (active | pending | revoked)
 * so listActive() can skip inactive secrets without fetching their values.
 *
 * Table Storage holds migration reservation locks.
 * Table name: agent-identity-locks
 * Partition key: "lock"  (constant — all locks in one partition for simplicity)
 * Row key: the credential ref being locked
 * Columns: migrationId (string), expiresAt (number — Unix epoch seconds)
 *
 * Azure setup:
 *   1. Create an Azure Key Vault and store each Credential as a JSON secret.
 *      Set the secret's ContentType to "active", "pending", or "revoked".
 *   2. Create a Storage Account and a Table named "agentidentitylocks".
 *      (Table names may not contain hyphens — use "agentidentitylocks".)
 *   3. Grant the running identity:
 *        Key Vault Secrets User  (read secrets)
 *        Key Vault Secrets Officer  (only needed for write operations)
 *        Storage Table Data Contributor  (read + write locks table)
 *   4. Set AZURE_KEYVAULT_URL and AZURE_TABLES_ENDPOINT environment variables,
 *      or pass them as constructor options.
 *      DefaultAzureCredential resolves auth automatically from:
 *        - Managed Identity (production)
 *        - AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET env vars
 *        - Azure CLI (local development)
 *        - Workload Identity (AKS)
 */
import { SecretClient } from '@azure/keyvault-secrets';
import { TableClient, odata } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';

export interface AzureKeyVaultCredentialStoreOptions {
  /**
   * Full URL of the Azure Key Vault, e.g. https://my-vault.vault.azure.net
   * Falls back to AZURE_KEYVAULT_URL environment variable.
   */
  keyVaultUrl?: string;
  /**
   * Full URL of the Azure Table Storage endpoint,
   * e.g. https://myaccount.table.core.windows.net
   * Falls back to AZURE_TABLES_ENDPOINT environment variable.
   */
  tablesEndpoint?: string;
  /**
   * Name of the Table Storage table used for migration locks.
   * Default: 'agentidentitylocks'
   * Note: Azure Table names may not contain hyphens.
   */
  locksTable?: string;
}

interface LockEntity {
  partitionKey: string;
  rowKey: string;
  migrationId: string;
  expiresAt: number;
}

export class AzureKeyVaultCredentialStore implements CredentialStore {
  private readonly secrets: SecretClient;
  private readonly table: TableClient;

  constructor(options: AzureKeyVaultCredentialStoreOptions = {}) {
    const vaultUrl =
      options.keyVaultUrl ?? process.env['AZURE_KEYVAULT_URL'] ?? '';
    if (!vaultUrl) {
      throw new Error(
        'AzureKeyVaultCredentialStore: keyVaultUrl is required. ' +
          'Pass it as an option or set AZURE_KEYVAULT_URL.'
      );
    }

    const tablesEndpoint =
      options.tablesEndpoint ?? process.env['AZURE_TABLES_ENDPOINT'] ?? '';
    if (!tablesEndpoint) {
      throw new Error(
        'AzureKeyVaultCredentialStore: tablesEndpoint is required. ' +
          'Pass it as an option or set AZURE_TABLES_ENDPOINT.'
      );
    }

    const locksTable = options.locksTable ?? 'agentidentitylocks';
    const credential = new DefaultAzureCredential();

    this.secrets = new SecretClient(vaultUrl, credential);
    this.table = new TableClient(tablesEndpoint, locksTable, credential);
  }

  // ─── CredentialStore: reads ──────────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    try {
      const secret = await this.secrets.getSecret(ref);
      if (!secret.value) return null;
      // contentType carries status; skip non-active secrets without parsing JSON
      if (secret.properties.contentType !== 'active') return null;
      const cred: Credential = JSON.parse(secret.value);
      return cred.status === 'active' ? cred : null;
    } catch {
      return null;
    }
  }

  async listActive(): Promise<Credential[]> {
    const results: Credential[] = [];
    try {
      for await (const secretProperties of this.secrets.listPropertiesOfSecrets()) {
        // Only fetch value for secrets tagged as active
        if (secretProperties.contentType !== 'active') continue;
        if (!secretProperties.enabled) continue;
        const name = secretProperties.name;
        if (!name) continue;
        try {
          const secret = await this.secrets.getSecret(name);
          if (!secret.value) continue;
          const cred: Credential = JSON.parse(secret.value);
          if (cred.status === 'active') results.push(cred);
        } catch {
          // malformed secret — skip
        }
      }
    } catch {
      // Key Vault unreachable — return empty rather than throw
    }
    return results;
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const all = await this.listActive();
    return all.filter((c) => c.kind === kind);
  }

  // ─── CredentialStore: migration locks ────────────────────────────────────

  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Check for an existing unexpired lock held by a different migration
    try {
      const existing = await this.table.getEntity<LockEntity>('lock', ref);
      if (
        existing.migrationId !== migrationId &&
        existing.expiresAt > nowSeconds
      ) {
        return false; // locked by another migration and not yet expired
      }
    } catch {
      // Entity does not exist — proceed to create
    }

    // Upsert the lock (merge semantics — overwrites existing row if present)
    try {
      await this.table.upsertEntity<LockEntity>(
        {
          partitionKey: 'lock',
          rowKey: ref,
          migrationId,
          expiresAt,
        },
        'Replace'
      );
      return true;
    } catch {
      return false;
    }
  }

  async release(ref: string, migrationId: string): Promise<void> {
    try {
      const existing = await this.table.getEntity<LockEntity>('lock', ref);
      // Only delete if this migration owns the lock
      if (existing.migrationId !== migrationId) return;
      await this.table.deleteEntity('lock', ref);
    } catch {
      // Already released or never held — idempotent
    }
  }
}
