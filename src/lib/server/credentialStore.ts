/**
 * Server-side credential store factory (G5 — production store wiring).
 *
 * Selects the appropriate CredentialStore implementation based on environment
 * variables, caches the singleton per Node.js worker process, and returns it
 * to API route handlers. Falls back to MemoryCredentialStore (using
 * DEFAULT_CREDENTIALS from src/lib/credentials.ts) when no production store
 * is configured or when a cloud store fails to initialise.
 *
 * ─── Store selection ─────────────────────────────────────────────────────────
 *
 * CREDENTIAL_STORE_TYPE = memory | vault | aws | azure   (default: memory)
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
 * ─── Routing rules ────────────────────────────────────────────────────────────
 *   ROUTING_RULES_PATH = /etc/agent-identity/rules.json
 *     When set, routing rules are read from this JSON file on first request
 *     and cached. Allows rules to be updated in Docker / Kubernetes deployments
 *     without code changes or container rebuilds.
 *     When absent, DEFAULT_ROUTING_RULES from src/lib/credentials.ts are used.
 *
 * ─── Notes ────────────────────────────────────────────────────────────────────
 *   - The store instance is a module-level singleton. All API route handlers
 *     within the same Node.js worker process share it, so MemoryCredentialStore
 *     reservation state (reserve / release) is consistent within a process.
 *   - For multi-worker deployments use the Vault / AWS / Azure stores, which
 *     are backed by distributed locking mechanisms.
 *   - Next.js hot-reload in development mode may reset the module cache,
 *     causing a new store instance on the next request. This is expected in dev.
 *   - Call _resetStoreCache() in tests to force a fresh instance.
 */

import type { CredentialStore, RoutingRule } from '../types';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '../credentials';
import { MemoryCredentialStore } from '@datacules/agent-identity';

// ─── Module-level singletons (one per Node.js worker process) ────────────────

let _storeInstance: CredentialStore | null = null;
let _rulesCache: RoutingRule[] | null = null;

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

  // ── Default / fallback: MemoryCredentialStore ────────────────────────────
  _storeInstance = new MemoryCredentialStore(DEFAULT_CREDENTIALS);
  return _storeInstance;
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
 * Reset the cached store and rules instances.
 *
 * FOR TESTS ONLY. Resets module-level singletons so the next call to
 * getServerStore() / getServerRules() creates a fresh instance reflecting
 * any updated environment variables.
 *
 * @internal
 */
export function _resetStoreCache(): void {
  _storeInstance = null;
  _rulesCache    = null;
}
