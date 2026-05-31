/**
 * credentialStore.test.ts — Unit tests for the server-side credential store factory.
 *
 * 10 cases:
 *
 * getServerStore
 *   1. Default (CREDENTIAL_STORE_TYPE absent)            → MemoryCredentialStore
 *   2. CREDENTIAL_STORE_TYPE=memory (explicit)           → MemoryCredentialStore
 *   3. CREDENTIAL_STORE_TYPE=vault, all env vars set     → VaultCredentialStore (mocked)
 *   4. CREDENTIAL_STORE_TYPE=vault, VAULT_TOKEN missing  → MemoryCredentialStore fallback
 *   5. CREDENTIAL_STORE_TYPE=aws                         → AwsCredentialStore (mocked)
 *   6. CREDENTIAL_STORE_TYPE=azure, all env vars set     → AzureKeyVaultCredentialStore (mocked)
 *   7. CREDENTIAL_STORE_TYPE=azure, AZURE_TABLES_ENDPOINT missing → MemoryCredentialStore fallback
 *   8. Cache: second getServerStore() call returns the same object reference
 *
 * getServerRules
 *   9. ROUTING_RULES_PATH absent → DEFAULT_ROUTING_RULES (non-empty array)
 *  10. ROUTING_RULES_PATH set to a temp JSON file → rules loaded from file
 *
 * Cloud store packages are mocked via vi.mock() so no live service is required.
 * The mock classes expose a __isMock tag that lets tests identify which store
 * was returned. MemoryCredentialStore is NOT mocked — its findByRefSync method
 * serves as the duck-type indicator distinguishing it from cloud stores.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// ─── Mock cloud store packages ────────────────────────────────────────────────
// vi.mock() is hoisted before imports and intercepts dynamic import() calls.

vi.mock('@datacules/agent-identity-store-vault', () => ({
  VaultCredentialStore: class MockVaultStore {
    readonly __isMock = 'vault';
    constructor(_opts: unknown) {}
    async findByRef()  { return null; }
    async listActive() { return []; }
    async listByKind() { return []; }
  },
}));

vi.mock('@datacules/agent-identity-store-aws', () => ({
  AwsCredentialStore: class MockAwsStore {
    readonly __isMock = 'aws';
    constructor(_opts: unknown) {}
    async findByRef()  { return null; }
    async listActive() { return []; }
    async listByKind() { return []; }
  },
}));

vi.mock('@datacules/agent-identity-store-azure', () => ({
  AzureKeyVaultCredentialStore: class MockAzureStore {
    readonly __isMock = 'azure';
    constructor(_opts: unknown) {}
    async findByRef()  { return null; }
    async listActive() { return []; }
    async listByKind() { return []; }
  },
}));

// Import AFTER vi.mock() declarations
import { getServerStore, getServerRules, _resetStoreCache } from './credentialStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MemoryCredentialStore exposes findByRefSync; cloud store mocks do not. */
function isMemoryStore(store: unknown): boolean {
  return typeof (store as Record<string, unknown>).findByRefSync === 'function';
}

/** Returns the __isMock tag or 'memory' for MemoryCredentialStore. */
function storeKind(store: unknown): string {
  return (store as Record<string, unknown>).__isMock as string ?? 'memory';
}

// ─── getServerStore ───────────────────────────────────────────────────────────

describe('getServerStore', () => {
  beforeEach(() => {
    _resetStoreCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns MemoryCredentialStore when CREDENTIAL_STORE_TYPE is absent', async () => {
    const store = await getServerStore();
    expect(isMemoryStore(store)).toBe(true);
    expect(storeKind(store)).toBe('memory');
  });

  it('returns MemoryCredentialStore when CREDENTIAL_STORE_TYPE=memory (explicit)', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'memory');
    const store = await getServerStore();
    expect(isMemoryStore(store)).toBe(true);
  });

  it('returns VaultCredentialStore when CREDENTIAL_STORE_TYPE=vault with all env vars', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'vault');
    vi.stubEnv('CREDENTIAL_STORE_URL', 'https://vault.example.com');
    vi.stubEnv('VAULT_TOKEN', 'hvs.test-token-abc123');
    const store = await getServerStore();
    expect(storeKind(store)).toBe('vault');
    expect(isMemoryStore(store)).toBe(false);
  });

  it('falls back to MemoryCredentialStore when CREDENTIAL_STORE_TYPE=vault but VAULT_TOKEN is absent', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'vault');
    vi.stubEnv('CREDENTIAL_STORE_URL', 'https://vault.example.com');
    // VAULT_TOKEN deliberately not set — code returns early before dynamic import
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await getServerStore();
    expect(isMemoryStore(store)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('VAULT_TOKEN'));
    warnSpy.mockRestore();
  });

  it('returns AwsCredentialStore when CREDENTIAL_STORE_TYPE=aws', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'aws');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    const store = await getServerStore();
    expect(storeKind(store)).toBe('aws');
    expect(isMemoryStore(store)).toBe(false);
  });

  it('returns AzureKeyVaultCredentialStore when CREDENTIAL_STORE_TYPE=azure with all env vars', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'azure');
    vi.stubEnv('AZURE_KEYVAULT_URL', 'https://acme.vault.azure.net');
    vi.stubEnv('AZURE_TABLES_ENDPOINT', 'https://acme.table.core.windows.net');
    const store = await getServerStore();
    expect(storeKind(store)).toBe('azure');
    expect(isMemoryStore(store)).toBe(false);
  });

  it('falls back to MemoryCredentialStore when CREDENTIAL_STORE_TYPE=azure but AZURE_TABLES_ENDPOINT is absent', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'azure');
    vi.stubEnv('AZURE_KEYVAULT_URL', 'https://acme.vault.azure.net');
    // AZURE_TABLES_ENDPOINT deliberately not set
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await getServerStore();
    expect(isMemoryStore(store)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AZURE_TABLES_ENDPOINT'));
    warnSpy.mockRestore();
  });

  it('caches the store instance — calling getServerStore() twice returns the same object', async () => {
    const first  = await getServerStore();
    const second = await getServerStore();
    expect(first).toBe(second);
  });
});

// ─── getServerRules ───────────────────────────────────────────────────────────

describe('getServerRules', () => {
  beforeEach(() => {
    _resetStoreCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns DEFAULT_ROUTING_RULES (non-empty) when ROUTING_RULES_PATH is absent', async () => {
    const rules = await getServerRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    // Verify the shape of the first rule
    expect(rules[0]).toHaveProperty('id');
    expect(rules[0]).toHaveProperty('credentialRef');
    expect(rules[0]).toHaveProperty('priority');
  });

  it('loads routing rules from a JSON file when ROUTING_RULES_PATH is set', async () => {
    const testRules = [
      {
        id: 'rule-file-test',
        description: 'Loaded from file',
        credentialRef: 'test-slot',
        credentialKind: 'fixed',
        priority: 99,
      },
    ];
    // Write a temp rules file
    const tmpPath = path.join(os.tmpdir(), `agent-identity-rules-${Date.now()}.json`);
    await fs.writeFile(tmpPath, JSON.stringify(testRules), 'utf-8');

    try {
      vi.stubEnv('ROUTING_RULES_PATH', tmpPath);
      const rules = await getServerRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('rule-file-test');
      expect(rules[0].priority).toBe(99);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });
});
