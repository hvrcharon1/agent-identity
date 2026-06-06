/**
 * Server-side credential store factory (G5 — production store wiring).
 *
 * Selects the appropriate CredentialStore / ApprovalStore / BudgetStore
 * implementation based on environment variables, caches singletons per Node.js
 * worker process, and returns them to API route handlers. Falls back to in-memory
 * implementations when no production store is configured or when a cloud store
 * fails to initialise.
 *
 * ─── Credential store selection ──────────────────────────────────────────────
 *
 * CREDENTIAL_STORE_TYPE = memory | vault | aws | azure | libsql | dynamic
 *                         (default: memory)
 *
 * ─── HashiCorp Vault KV v2 ───────────────────────────────────────────────────
 *   CREDENTIAL_STORE_TYPE = vault
 *   CREDENTIAL_STORE_URL  = https://vault.example.com       (required)
 *   VAULT_TOKEN           = hvs.xxxxxxxxxxxxxxxxxxxxxxxx    (required)
 *   VAULT_MOUNT_PATH      = secret                          (default)
 *   VAULT_PREFIX          = agent-identity                  (default)
 *
 * ─── AWS Secrets Manager + DynamoDB ──────────────────────────────────────────
 *   CREDENTIAL_STORE_TYPE = aws
 *   AWS_REGION            = us-east-1  (optional — uses SDK default credential chain)
 *   AWS_LOCKS_TABLE       = agent-identity-locks             (default)
 *
 * ─── Azure Key Vault + Table Storage ─────────────────────────────────────────
 *   CREDENTIAL_STORE_TYPE = azure
 *   AZURE_KEYVAULT_URL    = https://acme.vault.azure.net     (required)
 *   AZURE_TABLES_ENDPOINT = https://acme.table.core.windows.net  (required)
 *
 * ─── LibSQL / Turso ──────────────────────────────────────────────────────────
 *   CREDENTIAL_STORE_TYPE = libsql
 *   LIBSQL_URL            = file:./agent-identity.db   (embedded SQLite)
 *                         | libsql://your-db.turso.io  (Turso distributed)
 *                         | :memory:                   (in-process test)
 *   LIBSQL_AUTH_TOKEN     = <turso auth token>          (not required for local)
 *
 *   When LIBSQL_URL is set (regardless of CREDENTIAL_STORE_TYPE), all four
 *   LibSQL stores share a single @libsql/client connection cached as a
 *   module-level singleton. getServerApprovalStore() and getServerBudgetStore()
 *   automatically use LibSQL when LIBSQL_URL is configured.
 *
 * ─── Dynamic / JIT provisioning ──────────────────────────────────────────────
 *   CREDENTIAL_STORE_TYPE = dynamic
 *   DYNAMIC_PROVISIONER   = vault | aws | azure   (required)
 *
 *   Vault dynamic secrets:
 *     CREDENTIAL_STORE_URL  = https://vault.example.com (required)
 *     VAULT_TOKEN           = hvs.xxxxx               (required)
 *     VAULT_DYNAMIC_MOUNT   = database                (required)
 *     VAULT_DYNAMIC_ROLE    = crm-readonly            (required)
 *
 *   AWS IAM Roles Anywhere:
 *     AWS_ROLES_ANYWHERE_PROFILE_ARN      = arn:aws:rolesanywhere:...  (required)
 *     AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN = arn:aws:rolesanywhere:...  (required)
 *     AWS_REGION                          = us-east-1                  (required)
 *
 *   Azure Managed Identity:
 *     AZURE_MI_CLIENT_ID = <client ID>                      (optional — system-assigned if absent)
 *     AZURE_MI_RESOURCE  = https://vault.azure.net          (default)
 *
 * ─── Approval store selection ────────────────────────────────────────────────
 *
 * getServerApprovalStore() returns LibSqlApprovalStore when LIBSQL_URL is set,
 * falling back to MemoryApprovalStore. The LibSQL stores share the same
 * @libsql/client connection as the LibSQL credential store.
 *
 * ─── Budget store selection ──────────────────────────────────────────────────
 *
 * getServerBudgetStore() returns LibSqlBudgetStore when LIBSQL_URL is set,
 * falling back to MemoryBudgetStore.
 *
 * ─── Routing rules ────────────────────────────────────────────────────────────
 *   ROUTING_RULES_PATH = /etc/agent-identity/rules.json
 *     When set, routing rules are read from this JSON file on first request
 *     and cached. Allows rules to be updated in Docker / Kubernetes deployments
 *     without code changes or container rebuilds.
 *     When absent, DEFAULT_ROUTING_RULES from src/lib/credentials.ts are used.
 *
 * ─── Notes ────────────────────────────────────────────────────────────────────
 *   - All store instances are module-level singletons. All API route handlers
 *     within the same Node.js worker process share them.
 *   - For multi-worker deployments use the Vault / AWS / Azure / LibSQL stores,
 *     which are backed by distributed locking or remote databases.
 *   - Next.js hot-reload in development mode may reset the module cache,
 *     causing a new store instance on the next request. This is expected in dev.
 *   - Call _resetStoreCache() in tests to force a fresh instance.
 */

import type { CredentialStore, RoutingRule } from '../types';
import type { ApprovalStore } from '../approval';
import type { BudgetStore } from '../budget';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '../credentials';
import { MemoryCredentialStore } from '@datacules/agent-identity';
import { MemoryApprovalStore } from '../approval';
import { MemoryBudgetStore } from '../budget';

// ─── Module-level singletons (one per Node.js worker process) ────────────────

let _storeInstance: CredentialStore | null = null;
let _approvalStoreInstance: ApprovalStore | null = null;
let _budgetStoreInstance: BudgetStore | null = null;
let _rulesCache: RoutingRule[] | null = null;

/** Cached LibSQL stores object — shared connection for all four store types. */
let _libSqlCache: {
  credentialStore: CredentialStore;
  approvalStore: ApprovalStore;
  budgetStore: BudgetStore;
} | null = null;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the shared LibSQL stores object, creating it on first call.
 * Returns null if LIBSQL_URL is not configured or if the package fails to load.
 */
async function getLibSqlCache(): Promise<typeof _libSqlCache> {
  if (_libSqlCache) return _libSqlCache;

  const url = process.env.LIBSQL_URL;
  if (!url) return null;

  try {
    const { createLibSqlStores } = await import('@datacules/agent-identity-store-libsql');
    const stores = await createLibSqlStores({
      url,
      authToken: process.env.LIBSQL_AUTH_TOKEN,
    });
    _libSqlCache = {
      credentialStore: stores.credentialStore,
      approvalStore:   stores.approvalStore,
      budgetStore:     stores.budgetStore,
    };
    return _libSqlCache;
  } catch (err) {
    console.error(
      '[agent-identity/server] Failed to initialise LibSQL stores:', err,
      '\nFalling back to in-memory stores.'
    );
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the configured CredentialStore instance, creating it on first call.
 *
 * Reads CREDENTIAL_STORE_TYPE to select the store backend. Falls back to
 * MemoryCredentialStore if the type is unknown, required configuration is
 * missing, or the store package cannot be loaded.
 */
export async function getServerStore(): Promise<CredentialStore> {
  if (_storeInstance) return _storeInstance;

  const storeType = (process.env.CREDENTIAL_STORE_TYPE ?? 'memory').toLowerCase().trim();

  // ── Vault ─────────────────────────────────────────────────────────────────
  if (storeType === 'vault') {
    const address = process.env.CREDENTIAL_STORE_URL;
    const token   = process.env.VAULT_TOKEN;

    if (!address || !token) {
      console.warn(
        '[agent-identity/server] CREDENTIAL_STORE_TYPE=vault requires both ' +
        'CREDENTIAL_STORE_URL and VAULT_TOKEN. ' +
        'Falling back to MemoryCredentialStore.'
      );
    } else {
      try {
        const { VaultCredentialStore } = await import('@datacules/agent-identity-store-vault');
        _storeInstance = new VaultCredentialStore({
          address,
          token,
          mountPath: process.env.VAULT_MOUNT_PATH ?? 'secret',
          prefix:    process.env.VAULT_PREFIX    ?? 'agent-identity',
        });
        return _storeInstance;
      } catch (err) {
        console.error(
          '[agent-identity/server] Failed to initialise VaultCredentialStore:', err,
          '\nFalling back to MemoryCredentialStore.'
        );
      }
    }
  }

  // ── AWS Secrets Manager + DynamoDB ────────────────────────────────────────
  if (storeType === 'aws') {
    try {
      const { AwsCredentialStore } = await import('@datacules/agent-identity-store-aws');
      _storeInstance = new AwsCredentialStore({
        region:     process.env.AWS_REGION,
        locksTable: process.env.AWS_LOCKS_TABLE ?? 'agent-identity-locks',
      });
      return _storeInstance;
    } catch (err) {
      console.error(
        '[agent-identity/server] Failed to initialise AwsCredentialStore:', err,
        '\nFalling back to MemoryCredentialStore.'
      );
    }
  }

  // ── Azure Key Vault + Table Storage ───────────────────────────────────────
  if (storeType === 'azure') {
    const keyVaultUrl    = process.env.AZURE_KEYVAULT_URL;
    const tablesEndpoint = process.env.AZURE_TABLES_ENDPOINT;

    if (!keyVaultUrl || !tablesEndpoint) {
      console.warn(
        '[agent-identity/server] CREDENTIAL_STORE_TYPE=azure requires both ' +
        'AZURE_KEYVAULT_URL and AZURE_TABLES_ENDPOINT. ' +
        'Falling back to MemoryCredentialStore.'
      );
    } else {
      try {
        const { AzureKeyVaultCredentialStore } = await import('@datacules/agent-identity-store-azure');
        _storeInstance = new AzureKeyVaultCredentialStore({
          keyVaultUrl,
          tablesEndpoint,
        });
        return _storeInstance;
      } catch (err) {
        console.error(
          '[agent-identity/server] Failed to initialise AzureKeyVaultCredentialStore:', err,
          '\nFalling back to MemoryCredentialStore.'
        );
      }
    }
  }

  // ── LibSQL / Turso ────────────────────────────────────────────────────────
  if (storeType === 'libsql') {
    const libSql = await getLibSqlCache();
    if (libSql) {
      _storeInstance = libSql.credentialStore;
      return _storeInstance;
    }
    // getLibSqlCache() already logged the error — fall through to Memory
  }

  // ── Dynamic / JIT provisioning ────────────────────────────────────────────
  if (storeType === 'dynamic') {
    const provisioner = (process.env.DYNAMIC_PROVISIONER ?? '').toLowerCase().trim();
    try {
      const {
        DynamicCredentialStore,
        VaultDynamicProvisioner,
        AwsRolesAnywhereProvisioner,
        AzureManagedIdentityProvisioner,
      } = await import('@datacules/agent-identity-store-dynamic');

      if (provisioner === 'vault') {
        const address = process.env.CREDENTIAL_STORE_URL;
        const token   = process.env.VAULT_TOKEN;
        const mount   = process.env.VAULT_DYNAMIC_MOUNT;
        const role    = process.env.VAULT_DYNAMIC_ROLE;
        if (!address || !token || !mount || !role) {
          console.warn(
            '[agent-identity/server] DYNAMIC_PROVISIONER=vault requires ' +
            'CREDENTIAL_STORE_URL, VAULT_TOKEN, VAULT_DYNAMIC_MOUNT, VAULT_DYNAMIC_ROLE. ' +
            'Falling back to MemoryCredentialStore.'
          );
        } else {
          _storeInstance = new DynamicCredentialStore({
            provisioner: new VaultDynamicProvisioner({ vaultAddr: address, token, mount, role }),
          });
          return _storeInstance;
        }
      } else if (provisioner === 'aws') {
        const profileArn      = process.env.AWS_ROLES_ANYWHERE_PROFILE_ARN;
        const trustAnchorArn  = process.env.AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN;
        const region          = process.env.AWS_REGION ?? 'us-east-1';
        if (!profileArn || !trustAnchorArn) {
          console.warn(
            '[agent-identity/server] DYNAMIC_PROVISIONER=aws requires ' +
            'AWS_ROLES_ANYWHERE_PROFILE_ARN and AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN. ' +
            'Falling back to MemoryCredentialStore.'
          );
        } else {
          _storeInstance = new DynamicCredentialStore({
            provisioner: new AwsRolesAnywhereProvisioner({
              profileArn,
              roleArn: profileArn,   // roleArn inferred same as profile unless overridden
              trustAnchorArn,
              region,
            }),
          });
          return _storeInstance;
        }
      } else if (provisioner === 'azure') {
        _storeInstance = new DynamicCredentialStore({
          provisioner: new AzureManagedIdentityProvisioner({
            resource: process.env.AZURE_MI_RESOURCE ?? 'https://vault.azure.net',
            clientId: process.env.AZURE_MI_CLIENT_ID,
          }),
        });
        return _storeInstance;
      } else {
        console.warn(
          `[agent-identity/server] Unknown DYNAMIC_PROVISIONER='${provisioner}'. ` +
          'Expected vault|aws|azure. Falling back to MemoryCredentialStore.'
        );
      }
    } catch (err) {
      console.error(
        '[agent-identity/server] Failed to initialise DynamicCredentialStore:', err,
        '\nFalling back to MemoryCredentialStore.'
      );
    }
  }

  // ── Default / fallback: MemoryCredentialStore ────────────────────────────
  _storeInstance = new MemoryCredentialStore(DEFAULT_CREDENTIALS);
  return _storeInstance;
}

/**
 * Returns the configured ApprovalStore instance, creating it on first call.
 *
 * Returns LibSqlApprovalStore when LIBSQL_URL is configured (sharing the
 * same @libsql/client connection as getServerStore), otherwise falls back
 * to MemoryApprovalStore. The Memory fallback does not persist across
 * restarts or scale out to multiple process replicas.
 */
export async function getServerApprovalStore(): Promise<ApprovalStore> {
  if (_approvalStoreInstance) return _approvalStoreInstance;

  const libSql = await getLibSqlCache();
  if (libSql) {
    _approvalStoreInstance = libSql.approvalStore;
    return _approvalStoreInstance;
  }

  _approvalStoreInstance = new MemoryApprovalStore();
  return _approvalStoreInstance;
}

/**
 * Returns the configured BudgetStore instance, creating it on first call.
 *
 * Returns LibSqlBudgetStore when LIBSQL_URL is configured, otherwise falls
 * back to MemoryBudgetStore. The LibSQL store persists counters across
 * restarts and in multi-replica deployments using a Turso remote URL.
 */
export async function getServerBudgetStore(): Promise<BudgetStore> {
  if (_budgetStoreInstance) return _budgetStoreInstance;

  const libSql = await getLibSqlCache();
  if (libSql) {
    _budgetStoreInstance = libSql.budgetStore;
    return _budgetStoreInstance;
  }

  _budgetStoreInstance = new MemoryBudgetStore();
  return _budgetStoreInstance;
}

/**
 * Returns the configured routing rules, loading them on first call.
 *
 * When ROUTING_RULES_PATH is set to a JSON file path, loads rules from that
 * file. Falls back to DEFAULT_ROUTING_RULES on read or parse failure.
 * When ROUTING_RULES_PATH is absent, uses DEFAULT_ROUTING_RULES directly.
 */
export async function getServerRules(): Promise<RoutingRule[]> {
  if (_rulesCache) return _rulesCache;

  const rulesPath = process.env.ROUTING_RULES_PATH;
  if (rulesPath) {
    try {
      const fs  = await import('fs/promises');
      const raw = await fs.readFile(rulesPath, 'utf-8');
      _rulesCache = JSON.parse(raw) as RoutingRule[];
      return _rulesCache;
    } catch (err) {
      console.error(
        '[agent-identity/server] Failed to load routing rules from', rulesPath, ':', err,
        '\nFalling back to DEFAULT_ROUTING_RULES.'
      );
    }
  }

  _rulesCache = DEFAULT_ROUTING_RULES;
  return _rulesCache;
}

/**
 * @deprecated Use getServerStore() instead.
 *
 * Returns all active credentials from the configured store.
 * Retained for backward compatibility — callers should switch to
 * getServerStore() to benefit from async cloud stores.
 */
export async function getServerCredentials() {
  const store = await getServerStore();
  return store.listActive();
}

/**
 * Reset all cached store and rules instances.
 *
 * FOR TESTS ONLY. Resets module-level singletons so the next call to
 * getServerStore() / getServerApprovalStore() / getServerBudgetStore()
 * / getServerRules() creates a fresh instance reflecting any updated
 * environment variables.
 *
 * @internal
 */
export function _resetStoreCache(): void {
  _storeInstance         = null;
  _approvalStoreInstance = null;
  _budgetStoreInstance   = null;
  _libSqlCache           = null;
  _rulesCache            = null;
}
