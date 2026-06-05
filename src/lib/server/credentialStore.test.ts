/**
 * credentialStore.test.ts — Unit tests for the server-side store factory.
 *
 * 20 cases:
 *
 * getServerStore
 *   1.  Default (CREDENTIAL_STORE_TYPE absent)             → MemoryCredentialStore
 *   2.  CREDENTIAL_STORE_TYPE=memory (explicit)            → MemoryCredentialStore
 *   3.  CREDENTIAL_STORE_TYPE=vault, all env vars set      → VaultCredentialStore (mocked)
 *   4.  CREDENTIAL_STORE_TYPE=vault, VAULT_TOKEN missing   → MemoryCredentialStore fallback
 *   5.  CREDENTIAL_STORE_TYPE=aws                          → AwsCredentialStore (mocked)
 *   6.  CREDENTIAL_STORE_TYPE=azure, all env vars set      → AzureKeyVaultCredentialStore (mocked)
 *   7.  CREDENTIAL_STORE_TYPE=azure, AZURE_TABLES_ENDPOINT missing → MemoryCredentialStore fallback
 *   8.  CREDENTIAL_STORE_TYPE=libsql, LIBSQL_URL set       → LibSqlCredentialStore (mocked)
 *   9.  CREDENTIAL_STORE_TYPE=libsql, LIBSQL_URL absent    → MemoryCredentialStore fallback
 *  10.  CREDENTIAL_STORE_TYPE=dynamic, vault provisioner   → DynamicCredentialStore (mocked)
 *  11.  CREDENTIAL_STORE_TYPE=dynamic, aws provisioner     → DynamicCredentialStore (mocked)
 *  12.  CREDENTIAL_STORE_TYPE=dynamic, azure provisioner   → DynamicCredentialStore (mocked)
 *  13.  CREDENTIAL_STORE_TYPE=dynamic, unknown provisioner → MemoryCredentialStore fallback
 *  14.  Cache: second getServerStore() call returns the same object reference
 *
 * getServerApprovalStore
 *  15.  LIBSQL_URL absent                                  → MemoryApprovalStore
 *  16.  LIBSQL_URL set                                     → LibSqlApprovalStore (mocked)
 *
 * getServerBudgetStore
 *  17.  LIBSQL_URL absent                                  → MemoryBudgetStore
 *  18.  LIBSQL_URL set                                     → LibSqlBudgetStore (mocked)
 *
 * getServerRules
 *  19.  ROUTING_RULES_PATH absent → DEFAULT_ROUTING_RULES (non-empty array)
 *  20.  ROUTING_RULES_PATH set to a temp JSON file → rules loaded from file
 *
 * Cloud / LibSQL / Dynamic store packages are mocked via vi.mock() so no live
 * service is required. Mock classes expose a __isMock tag for identification.
 * MemoryCredentialStore is NOT mocked — its findByRefSync method identifies it.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// ─── Mock cloud store packages ────────────────────────────────────────────────

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

vi.mock('@datacules/agent-identity-store-libsql', () => ({
  createLibSqlStores: async (_opts: unknown) => ({
    credentialStore: { __isMock: 'libsql-cred', async findByRef() { return null; }, async listActive() { return []; }, async listByKind() { return []; } },
    approvalStore:   { __isMock: 'libsql-approval', async create() {}, async get() { return null; }, async update() {}, async listPending() { return []; } },
    budgetStore:     { __isMock: 'libsql-budget', listHourlyBuckets: async () => [], async getHourlyCount() { return 0; }, async incrementHourlyCount() {}, async getConcurrentSessions() { return 0; }, async getDailySpend() { return 0; }, async resetHourly() {}, async resetDaily() {} },
    auditLogger:     { __isMock: 'libsql-audit' },
    client:          {},
  }),
  LibSqlBudgetStore: class MockLibSqlBudgetStore {
    readonly __isMock = 'libsql-budget';
  },
}));

vi.mock('@datacules/agent-identity-store-dynamic', () => ({
  DynamicCredentialStore: class MockDynamicStore {
    readonly __isMock = 'dynamic';
    constructor(_opts: unknown) {}
    async findByRef()  { return null; }
    async listActive() { return []; }
    async listByKind() { return []; }
  },
  VaultDynamicProvisioner:          class { id = 'vault-dynamic'; constructor(_o: unknown) {} },
  AwsRolesAnywhereProvisioner:      class { id = 'aws-roles-anywhere'; constructor(_o: unknown) {} },
  AzureManagedIdentityProvisioner:  class { id = 'azure-managed-identity'; constructor(_o: unknown) {} },
}));

// Import AFTER vi.mock() declarations
import {
  getServerStore,
  getServerApprovalStore,
  getServerBudgetStore,
  getServerRules,
  _resetStoreCache,
} from './credentialStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MemoryCredentialStore exposes findByRefSync; cloud store mocks do not. */
function isMemoryStore(store: unknown): boolean {
  return typeof (store as Record<string, unknown>).findByRefSync === 'function';
}

/** Returns the __isMock tag or 'memory' for MemoryCredentialStore. */
function storeKind(store: unknown): string {
  return (store as Record<string, unknown>).__isMock as string ?? 'memory';
}

/** Returns the __isMock tag on an approval/budget store, or 'memory-impl' for in-process instances. */
function sideStoreKind(store: unknown): string {
  const tag = (store as Record<string, unknown>).__isMock;
  if (tag) return tag as string;
  // Memory stores are real class instances — identify by method presence
  return 'memory-impl';
}

// ─── getServerStore ───────────────────────────────────────────────────────────

describe('getServerStore', () => {
  beforeEach(() => { _resetStoreCache(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns MemoryCredentialStore when CREDENTIAL_STORE_TYPE is absent', async () => {
    const store = await getServerStore();
    expect(isMemoryStore(store)).toBe(true);
  });

  it('returns MemoryCredentialStore when CREDENTIAL_STORE_TYPE=memory (explicit)', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'memory');
    expect(isMemoryStore(await getServerStore())).toBe(true);
  });

  it('returns VaultCredentialStore when CREDENTIAL_STORE_TYPE=vault with all env vars', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'vault');
    vi.stubEnv('CREDENTIAL_STORE_URL', 'https://vault.example.com');
    vi.stubEnv('VAULT_TOKEN', 'hvs.test-token-abc123');
    expect(storeKind(await getServerStore())).toBe('vault');
  });

  it('falls back to Memory when CREDENTIAL_STORE_TYPE=vault but VAULT_TOKEN is absent', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'vault');
    vi.stubEnv('CREDENTIAL_STORE_URL', 'https://vault.example.com');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isMemoryStore(await getServerStore())).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('VAULT_TOKEN'));
    warnSpy.mockRestore();
  });

  it('returns AwsCredentialStore when CREDENTIAL_STORE_TYPE=aws', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'aws');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    expect(storeKind(await getServerStore())).toBe('aws');
  });

  it('returns AzureKeyVaultCredentialStore when CREDENTIAL_STORE_TYPE=azure with all env vars', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'azure');
    vi.stubEnv('AZURE_KEYVAULT_URL', 'https://acme.vault.azure.net');
    vi.stubEnv('AZURE_TABLES_ENDPOINT', 'https://acme.table.core.windows.net');
    expect(storeKind(await getServerStore())).toBe('azure');
  });

  it('falls back to Memory when CREDENTIAL_STORE_TYPE=azure but AZURE_TABLES_ENDPOINT is absent', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'azure');
    vi.stubEnv('AZURE_KEYVAULT_URL', 'https://acme.vault.azure.net');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isMemoryStore(await getServerStore())).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AZURE_TABLES_ENDPOINT'));
    warnSpy.mockRestore();
  });

  it('returns LibSqlCredentialStore when CREDENTIAL_STORE_TYPE=libsql and LIBSQL_URL is set', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'libsql');
    vi.stubEnv('LIBSQL_URL', 'file:./test.db');
    expect(storeKind(await getServerStore())).toBe('libsql-cred');
  });

  it('falls back to Memory when CREDENTIAL_STORE_TYPE=libsql but LIBSQL_URL is absent', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'libsql');
    // LIBSQL_URL deliberately not set
    expect(isMemoryStore(await getServerStore())).toBe(true);
  });

  it('returns DynamicCredentialStore when CREDENTIAL_STORE_TYPE=dynamic, DYNAMIC_PROVISIONER=vault', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'dynamic');
    vi.stubEnv('DYNAMIC_PROVISIONER', 'vault');
    vi.stubEnv('CREDENTIAL_STORE_URL', 'https://vault.example.com');
    vi.stubEnv('VAULT_TOKEN', 'hvs.xxx');
    vi.stubEnv('VAULT_DYNAMIC_MOUNT', 'database');
    vi.stubEnv('VAULT_DYNAMIC_ROLE', 'crm-readonly');
    expect(storeKind(await getServerStore())).toBe('dynamic');
  });

  it('returns DynamicCredentialStore when CREDENTIAL_STORE_TYPE=dynamic, DYNAMIC_PROVISIONER=aws', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'dynamic');
    vi.stubEnv('DYNAMIC_PROVISIONER', 'aws');
    vi.stubEnv('AWS_ROLES_ANYWHERE_PROFILE_ARN', 'arn:aws:rolesanywhere:us-east-1:123:profile/test');
    vi.stubEnv('AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN', 'arn:aws:rolesanywhere:us-east-1:123:trust-anchor/test');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    expect(storeKind(await getServerStore())).toBe('dynamic');
  });

  it('returns DynamicCredentialStore when CREDENTIAL_STORE_TYPE=dynamic, DYNAMIC_PROVISIONER=azure', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'dynamic');
    vi.stubEnv('DYNAMIC_PROVISIONER', 'azure');
    expect(storeKind(await getServerStore())).toBe('dynamic');
  });

  it('falls back to Memory when DYNAMIC_PROVISIONER is unknown', async () => {
    vi.stubEnv('CREDENTIAL_STORE_TYPE', 'dynamic');
    vi.stubEnv('DYNAMIC_PROVISIONER', 'unknown-provisioner');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isMemoryStore(await getServerStore())).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DYNAMIC_PROVISIONER'));
    warnSpy.mockRestore();
  });

  it('caches the store instance — calling getServerStore() twice returns the same object', async () => {
    const first  = await getServerStore();
    const second = await getServerStore();
    expect(first).toBe(second);
  });
});

// ─── getServerApprovalStore ───────────────────────────────────────────────────

describe('getServerApprovalStore', () => {
  beforeEach(() => { _resetStoreCache(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns MemoryApprovalStore when LIBSQL_URL is absent', async () => {
    const store = await getServerApprovalStore();
    // MemoryApprovalStore has a `listPending` method and no __isMock tag
    expect(sideStoreKind(store)).toBe('memory-impl');
    expect(typeof store.listPending).toBe('function');
  });

  it('returns LibSqlApprovalStore when LIBSQL_URL is set', async () => {
    vi.stubEnv('LIBSQL_URL', 'file:./test.db');
    const store = await getServerApprovalStore();
    expect(sideStoreKind(store)).toBe('libsql-approval');
  });
});

// ─── getServerBudgetStore ─────────────────────────────────────────────────────

describe('getServerBudgetStore', () => {
  beforeEach(() => { _resetStoreCache(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns MemoryBudgetStore when LIBSQL_URL is absent', async () => {
    const store = await getServerBudgetStore();
    expect(sideStoreKind(store)).toBe('memory-impl');
    expect(typeof store.getHourlyCount).toBe('function');
  });

  it('returns LibSqlBudgetStore when LIBSQL_URL is set', async () => {
    vi.stubEnv('LIBSQL_URL', 'file:./test.db');
    const store = await getServerBudgetStore();
    expect(sideStoreKind(store)).toBe('libsql-budget');
  });
});

// ─── getServerRules ───────────────────────────────────────────────────────────

describe('getServerRules', () => {
  beforeEach(() => { _resetStoreCache(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns DEFAULT_ROUTING_RULES (non-empty) when ROUTING_RULES_PATH is absent', async () => {
    const rules = await getServerRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toHaveProperty('id');
    expect(rules[0]).toHaveProperty('credentialRef');
    expect(rules[0]).toHaveProperty('priority');
  });

  it('loads routing rules from a JSON file when ROUTING_RULES_PATH is set', async () => {
    const testRules = [{
      id: 'rule-file-test',
      description: 'Loaded from file',
      credentialRef: 'test-slot',
      credentialKind: 'fixed',
      priority: 99,
    }];
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
