import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultCredentialStore } from './index';

// All HTTP calls are mocked via vi.stubGlobal('fetch', ...).
// No live HashiCorp Vault instance is required to run these tests.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VAULT_ADDR = 'http://vault:8200';
const TOKEN = 'root-token';

const CRED = {
  id: 'cred-linear',
  kind: 'fixed' as const,
  name: 'Linear Service Account',
  scope: 'read:all',
  status: 'active' as const,
  ref: 'linear-service-account-slot',
  provider: 'openai' as const,
};

function makeStore() {
  return new VaultCredentialStore({ address: VAULT_ADDR, token: TOKEN });
}

function jsonOk(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

const CRED_VAULT_RESPONSE = { data: { data: CRED } };

describe('VaultCredentialStore', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── findByRef() ────────────────────────────────────────────────────────────

  describe('findByRef()', () => {
    it('returns the active credential on a 200 Vault KV v2 response', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk(CRED_VAULT_RESPONSE));
      const result = await makeStore().findByRef(CRED.ref);
      expect(result).toMatchObject({ id: 'cred-linear', status: 'active' });
    });

    it('sends the X-Vault-Token header with the configured token', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk(CRED_VAULT_RESPONSE));
      await makeStore().findByRef(CRED.ref);
      expect(mockFetch).toHaveBeenCalledWith(
        `${VAULT_ADDR}/v1/secret/data/agent-identity/${CRED.ref}`,
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Vault-Token': TOKEN }),
        })
      );
    });

    it('returns null when the credential status is not active', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { data: { ...CRED, status: 'revoked' } } })
      );
      expect(await makeStore().findByRef(CRED.ref)).toBeNull();
    });

    it('returns null on a non-ok Vault response (e.g. 404)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false } as Response);
      expect(await makeStore().findByRef('unknown-ref')).toBeNull();
    });

    it('returns null and does not throw when fetch throws a network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(makeStore().findByRef(CRED.ref)).resolves.toBeNull();
    });
  });

  // ── listActive() ──────────────────────────────────────────────────────────

  describe('listActive()', () => {
    it('returns all active credentials via metadata LIST then individual GETs', async () => {
      // First call: metadata list
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { keys: [CRED.ref] } })
      );
      // Second call: individual credential GET
      mockFetch.mockResolvedValueOnce(jsonOk(CRED_VAULT_RESPONSE));
      const result = await makeStore().listActive();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'cred-linear', status: 'active' });
    });

    it('returns an empty array when the metadata list response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false } as Response);
      expect(await makeStore().listActive()).toEqual([]);
    });

    it('returns an empty array when fetch throws on the metadata call', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Vault unreachable'));
      expect(await makeStore().listActive()).toEqual([]);
    });
  });

  // ── listByKind() ──────────────────────────────────────────────────────────

  describe('listByKind()', () => {
    it('returns only credentials matching the requested kind', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ data: { keys: [CRED.ref] } }));
      mockFetch.mockResolvedValueOnce(jsonOk(CRED_VAULT_RESPONSE)); // kind: 'fixed'
      const result = await makeStore().listByKind('fixed');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('fixed');
    });

    it('returns an empty array when no credentials match the requested kind', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ data: { keys: [CRED.ref] } }));
      mockFetch.mockResolvedValueOnce(jsonOk(CRED_VAULT_RESPONSE)); // kind: 'fixed'
      // Asking for 'user-delegated' — the fixed credential should not appear
      const result = await makeStore().listByKind('user-delegated');
      expect(result).toHaveLength(0);
    });
  });

  // ── reserve() ─────────────────────────────────────────────────────────────

  describe('reserve()', () => {
    it('returns true and writes the lock when no prior lock exists (read → 404)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false } as Response); // read → not found
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);  // write → success
      expect(await makeStore().reserve(CRED.ref, 'mig-1', 300)).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns false when the lock is held by a different migration within TTL', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 9999;
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { data: { migrationId: 'other-mig', expiresAt } } })
      );
      expect(await makeStore().reserve(CRED.ref, 'mig-1', 300)).toBe(false);
      expect(mockFetch).toHaveBeenCalledOnce(); // only the read — no write attempted
    });

    it('returns true when the same migration re-acquires its own active lock', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 9999;
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { data: { migrationId: 'mig-1', expiresAt } } })
      );
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);
      expect(await makeStore().reserve(CRED.ref, 'mig-1', 300)).toBe(true);
    });
  });

  // ── release() ─────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('issues a DELETE request when the migrationId matches the stored lock', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { data: { migrationId: 'mig-1' } } })
      );
      mockFetch.mockResolvedValueOnce({ ok: true } as Response); // DELETE
      await makeStore().release(CRED.ref, 'mig-1');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('makes only one fetch (the read) when the migrationId does not match', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonOk({ data: { data: { migrationId: 'other-mig' } } })
      );
      await makeStore().release(CRED.ref, 'mig-1');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('resolves without throwing when the lock is already gone (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('404 Not Found'));
      await expect(makeStore().release(CRED.ref, 'mig-1')).resolves.not.toThrow();
    });
  });
});
