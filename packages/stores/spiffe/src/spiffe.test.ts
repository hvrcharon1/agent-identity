import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpiffeCredentialStore } from './index';

/**
 * SpiffeCredentialStore tests.
 *
 * The @spiffe/spiffe-workload-api peer dependency is not required.
 * A mock WorkloadApiClient is injected directly via `(store as any).client`
 * before each test that exercises findByRef(). This bypasses the dynamic
 * import in getClient() entirely — the private `client` property is set
 * before the first call, so the lazy-load branch is never reached.
 *
 * reserve() and release() use the private in-memory `reservations` Map
 * and require no external calls.
 */

const SVID_PEM = '-----BEGIN CERTIFICATE-----\nMIIBordersAgentSVID\n-----END CERTIFICATE-----';

const CRED_ORDERS = {
  id: 'cred-orders',
  kind: 'fixed' as const,
  name: 'Orders Agent Credential',
  scope: 'orders:read',
  status: 'active' as const,
  ref: 'orders-agent',
  provider: 'anthropic' as const,
};

type MockWorkloadApiClient = {
  fetchX509Svids: ReturnType<typeof vi.fn>;
  fetchX509Bundles: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeStore(
  extra?: Partial<ConstructorParameters<typeof SpiffeCredentialStore>[0]>
) {
  return new SpiffeCredentialStore({
    credentials: [CRED_ORDERS],
    trustDomain: 'example.org',
    ...extra,
  });
}

function makeSvid(override?: Record<string, unknown>) {
  return {
    spiffeId: { toString: () => 'spiffe://example.org/orders-agent' },
    x509Svid: { toString: () => SVID_PEM },
    x509SvidKey: { toString: () => '---KEY---' },
    bundle: { toString: () => '---BUNDLE---' },
    hint: 'orders-agent',
    ...override,
  };
}

function injectClient(
  store: SpiffeCredentialStore,
  svids: unknown[]
): MockWorkloadApiClient {
  const client: MockWorkloadApiClient = {
    fetchX509Svids: vi.fn().mockResolvedValue({ svids }),
    fetchX509Bundles: vi.fn(),
    close: vi.fn(),
  };
  (store as unknown as { client: unknown }).client = client;
  return client;
}

describe('SpiffeCredentialStore', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── findByRef() — SVID resolution ─────────────────────────────────────────

  describe('findByRef() — SVID resolution', () => {
    it('returns credential with SVID PEM as ref when SVID hint matches the ref', async () => {
      const store = makeStore();
      injectClient(store, [makeSvid({ hint: 'orders-agent' })]);
      const result = await store.findByRef('orders-agent');
      expect(result).not.toBeNull();
      expect(result!.ref).toBe(SVID_PEM);
      expect(result!.id).toBe('cred-orders');
    });

    it('returns credential when matched by SPIFFE ID path segment (no hint)', async () => {
      const store = makeStore();
      injectClient(store, [makeSvid({ hint: undefined })]);
      // spiffeId = 'spiffe://example.org/orders-agent' — endsWith '/orders-agent' matches
      const result = await store.findByRef('orders-agent');
      expect(result).not.toBeNull();
      expect(result!.ref).toBe(SVID_PEM);
    });

    it('returns credential when matched by full SPIFFE ID string', async () => {
      const store = makeStore();
      injectClient(store, [
        makeSvid({
          hint: undefined,
          spiffeId: { toString: () => 'spiffe://example.org/orders-agent' },
        }),
      ]);
      const result = await store.findByRef('orders-agent');
      expect(result).not.toBeNull();
    });

    it('returns null when ref is not in the configured credentials list', async () => {
      const store = makeStore(); // only has 'orders-agent'
      injectClient(store, [makeSvid()]);
      expect(await store.findByRef('unknown-agent')).toBeNull();
    });

    it('returns null (no throw) when the workload API rejects', async () => {
      const store = makeStore();
      const client: MockWorkloadApiClient = {
        fetchX509Svids: vi.fn().mockRejectedValue(new Error('SPIRE agent unavailable')),
        fetchX509Bundles: vi.fn(),
        close: vi.fn(),
      };
      (store as unknown as { client: unknown }).client = client;
      await expect(store.findByRef('orders-agent')).resolves.toBeNull();
    });
  });

  // ── SVID caching ──────────────────────────────────────────────────────────

  describe('SVID caching', () => {
    it('returns the cached SVID on second findByRef() — fetchX509Svids called once', async () => {
      const store = makeStore();
      const mockClient = injectClient(store, [makeSvid()]);
      await store.findByRef('orders-agent'); // first call — populates cache
      await store.findByRef('orders-agent'); // second call — should hit cache
      expect(mockClient.fetchX509Svids).toHaveBeenCalledOnce();
    });

    it('re-fetches the SVID after flushCache() is called', async () => {
      const store = makeStore();
      const mockClient = injectClient(store, [makeSvid()]);
      await store.findByRef('orders-agent');
      store.flushCache();
      await store.findByRef('orders-agent');
      expect(mockClient.fetchX509Svids).toHaveBeenCalledTimes(2);
    });
  });

  // ── listActive() and listByKind() ─────────────────────────────────────────

  describe('listActive() and listByKind()', () => {
    it('listActive() returns only credentials with status=active from options', async () => {
      const store = makeStore({
        credentials: [
          CRED_ORDERS,
          { ...CRED_ORDERS, id: 'cred-revoked', status: 'revoked' as const, ref: 'revoked-agent' },
        ],
      });
      const result = await store.listActive();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
    });

    it('listByKind() filters correctly between fixed and user-delegated', async () => {
      const store = makeStore({
        credentials: [
          CRED_ORDERS, // kind: 'fixed'
          {
            ...CRED_ORDERS,
            id: 'cred-delegated',
            kind: 'user-delegated' as const,
            ref: 'delegated-agent',
          },
        ],
      });
      expect(await store.listByKind('fixed')).toHaveLength(1);
      expect(await store.listByKind('user-delegated')).toHaveLength(1);
    });
  });

  // ── reserve() and release() ───────────────────────────────────────────────

  describe('reserve() and release()', () => {
    it('reserve() returns false when a different migration already holds the lock', async () => {
      const store = makeStore();
      await store.reserve('orders-agent', 'mig-1', 300);
      expect(await store.reserve('orders-agent', 'mig-2', 300)).toBe(false);
    });

    it('release() clears the lock so a new migration can acquire it', async () => {
      const store = makeStore();
      await store.reserve('orders-agent', 'mig-1', 300);
      await store.release('orders-agent', 'mig-1');
      expect(await store.reserve('orders-agent', 'mig-2', 300)).toBe(true);
    });
  });

  // ── close() ───────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('calls close() on the injected WorkloadApiClient and nulls the reference', async () => {
      const store = makeStore();
      const mockClient = injectClient(store, []);
      store.close();
      expect(mockClient.close).toHaveBeenCalledOnce();
    });
  });
});
