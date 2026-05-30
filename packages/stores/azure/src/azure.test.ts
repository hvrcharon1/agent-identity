import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Azure SDK modules — constructors return objects with vi.fn() methods.
// vi.mock() calls are hoisted before imports by Vitest.
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(() => ({})),
}));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: vi.fn(() => ({
    getSecret: vi.fn(),
    listPropertiesOfSecrets: vi.fn(),
  })),
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: vi.fn(() => ({
    getEntity: vi.fn(),
    upsertEntity: vi.fn(),
    deleteEntity: vi.fn(),
  })),
  odata: vi.fn((s: string) => s),
}));

import { AzureKeyVaultCredentialStore } from './index.js';
import type { Credential } from '@datacules/agent-identity';

const makeCred = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'cred-openai',
  kind: 'fixed',
  name: 'OpenAI Key',
  scope: 'global',
  status: 'active',
  provider: 'openai',
  ref: 'openai-prod-slot',
  ...overrides,
});

// Minimal secret response shape returned by SecretClient.getSecret()
const makeSecretResponse = (cred: Credential) => ({
  value: JSON.stringify(cred),
  properties: { contentType: cred.status },
});

describe('AzureKeyVaultCredentialStore', () => {
  let store: AzureKeyVaultCredentialStore;
  let secretsMock: {
    getSecret: ReturnType<typeof vi.fn>;
    listPropertiesOfSecrets: ReturnType<typeof vi.fn>;
  };
  let tableMock: {
    getEntity: ReturnType<typeof vi.fn>;
    upsertEntity: ReturnType<typeof vi.fn>;
    deleteEntity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new AzureKeyVaultCredentialStore({
      keyVaultUrl: 'https://test.vault.azure.net',
      tablesEndpoint: 'https://test.table.core.windows.net',
    });
    // Access mock clients injected by the mocked SDK constructors
    secretsMock = (store as any).secrets as typeof secretsMock;
    tableMock = (store as any).table as typeof tableMock;
  });

  // ─── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws when keyVaultUrl is missing from both options and environment', () => {
      delete process.env['AZURE_KEYVAULT_URL'];
      expect(
        () =>
          new AzureKeyVaultCredentialStore({
            tablesEndpoint: 'https://test.table.core.windows.net',
          })
      ).toThrow('keyVaultUrl is required');
    });

    it('throws when tablesEndpoint is missing from both options and environment', () => {
      delete process.env['AZURE_TABLES_ENDPOINT'];
      expect(
        () =>
          new AzureKeyVaultCredentialStore({
            keyVaultUrl: 'https://test.vault.azure.net',
          })
      ).toThrow('tablesEndpoint is required');
    });
  });

  // ─── findByRef() ────────────────────────────────────────────────────────────

  describe('findByRef()', () => {
    it('returns active credential when Key Vault returns a secret with contentType=active', async () => {
      const cred = makeCred();
      secretsMock.getSecret.mockResolvedValue(makeSecretResponse(cred));
      expect(await store.findByRef('openai-prod-slot')).toEqual(cred);
    });

    it('returns null when contentType is not active (does not parse the value)', async () => {
      const cred = makeCred({ status: 'pending' });
      secretsMock.getSecret.mockResolvedValue({
        value: JSON.stringify(cred),
        properties: { contentType: 'pending' },
      });
      expect(await store.findByRef('openai-prod-slot')).toBeNull();
    });

    it('returns null when secret value is undefined', async () => {
      secretsMock.getSecret.mockResolvedValue({
        value: undefined,
        properties: { contentType: 'active' },
      });
      expect(await store.findByRef('openai-prod-slot')).toBeNull();
    });

    it('returns null without throwing when getSecret throws', async () => {
      secretsMock.getSecret.mockRejectedValue(new Error('SecretNotFound'));
      expect(await store.findByRef('missing-ref')).toBeNull();
    });
  });

  // ─── listActive() ───────────────────────────────────────────────────────────

  describe('listActive()', () => {
    it('returns active credentials iterated from listPropertiesOfSecrets and fetched via getSecret', async () => {
      const cred = makeCred();
      secretsMock.listPropertiesOfSecrets.mockReturnValue(
        (async function* () {
          yield { contentType: 'active', enabled: true, name: 'openai-prod-slot' };
        })()
      );
      secretsMock.getSecret.mockResolvedValue(makeSecretResponse(cred));
      const results = await store.listActive();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(cred);
    });

    it('skips secrets with contentType !== active without calling getSecret', async () => {
      secretsMock.listPropertiesOfSecrets.mockReturnValue(
        (async function* () {
          yield { contentType: 'pending', enabled: true, name: 'pending-slot' };
        })()
      );
      expect(await store.listActive()).toHaveLength(0);
      expect(secretsMock.getSecret).not.toHaveBeenCalled();
    });

    it('skips secrets with enabled=false', async () => {
      secretsMock.listPropertiesOfSecrets.mockReturnValue(
        (async function* () {
          yield { contentType: 'active', enabled: false, name: 'disabled-slot' };
        })()
      );
      expect(await store.listActive()).toHaveLength(0);
    });

    it('returns empty array when listPropertiesOfSecrets throws (Key Vault unreachable)', async () => {
      secretsMock.listPropertiesOfSecrets.mockReturnValue(
        // eslint-disable-next-line require-yield
        (async function* () {
          throw new Error('KeyVaultUnavailable');
        })()
      );
      expect(await store.listActive()).toEqual([]);
    });
  });

  // ─── listByKind() ───────────────────────────────────────────────────────────

  describe('listByKind()', () => {
    it('returns only credentials matching the requested kind', async () => {
      const fixed = makeCred({ kind: 'fixed', id: 'cred-fixed', ref: 'fixed-slot' });
      const delegated = makeCred({ kind: 'user-delegated', id: 'cred-user', ref: 'user-slot' });
      secretsMock.listPropertiesOfSecrets.mockReturnValue(
        (async function* () {
          yield { contentType: 'active', enabled: true, name: 'fixed-slot' };
          yield { contentType: 'active', enabled: true, name: 'user-slot' };
        })()
      );
      secretsMock.getSecret
        .mockResolvedValueOnce(makeSecretResponse(fixed))
        .mockResolvedValueOnce(makeSecretResponse(delegated));
      const result = await store.listByKind('fixed');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('fixed');
    });
  });

  // ─── reserve() ──────────────────────────────────────────────────────────────

  describe('reserve()', () => {
    it('returns true when no existing lock is found (getEntity throws) and upsert succeeds', async () => {
      tableMock.getEntity.mockRejectedValue(new Error('EntityNotFound'));
      tableMock.upsertEntity.mockResolvedValue({});
      expect(await store.reserve('cred-ref', 'mig-1', 300)).toBe(true);
    });

    it('returns false when a different migration holds an unexpired lock', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 600;
      tableMock.getEntity.mockResolvedValue({
        migrationId: 'other-migration',
        expiresAt: futureExpiry,
      });
      expect(await store.reserve('cred-ref', 'mig-2', 300)).toBe(false);
    });

    it('returns true when the same migration re-acquires its own lock', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 600;
      tableMock.getEntity.mockResolvedValue({
        migrationId: 'mig-1',
        expiresAt: futureExpiry,
      });
      tableMock.upsertEntity.mockResolvedValue({});
      expect(await store.reserve('cred-ref', 'mig-1', 300)).toBe(true);
    });
  });

  // ─── release() ──────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('deletes the entity when migrationId matches the stored lock owner', async () => {
      tableMock.getEntity.mockResolvedValue({
        migrationId: 'mig-1',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
      tableMock.deleteEntity.mockResolvedValue({});
      await store.release('cred-ref', 'mig-1');
      expect(tableMock.deleteEntity).toHaveBeenCalledWith('lock', 'cred-ref');
    });

    it('does not call deleteEntity when migrationId does not match the stored lock', async () => {
      tableMock.getEntity.mockResolvedValue({
        migrationId: 'other-mig',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
      await store.release('cred-ref', 'mig-1');
      expect(tableMock.deleteEntity).not.toHaveBeenCalled();
    });

    it('resolves without throwing when getEntity throws (lock already released)', async () => {
      tableMock.getEntity.mockRejectedValue(new Error('EntityNotFound'));
      await expect(store.release('cred-ref', 'mig-1')).resolves.toBeUndefined();
    });
  });
});
