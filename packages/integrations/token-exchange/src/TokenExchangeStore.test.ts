/**
 * TokenExchangeStore.test.ts — Vitest unit tests for RFC 8693 token exchange store.
 *
 * 12 cases across four groups. All HTTP calls are mocked via the fetchFn
 * constructor option — no live Authorization Server is required.
 *
 * Group 1 — findByRef: exchange flow (5 cases)
 *   1. returns null when ref is not found in configs
 *   2. exchanges subject token and returns Credential with access_token as ref
 *   3. sets expiresAt correctly from expires_in response field
 *   4. sends correct RFC 8693 form-encoded body to the token endpoint
 *   5. returns null when subjectTokenProvider returns null (unauthenticated caller)
 *
 * Group 2 — findByRef: resilience (2 cases)
 *   6. returns null when token endpoint responds with non-200 status
 *   7. returns null without throwing when fetch throws (network error)
 *
 * Group 3 — findByRef: caching (3 cases)
 *   8. caches exchanged token — fetch called once for two consecutive findByRef calls
 *   9. re-exchanges after invalidateCache(ref)
 *  10. re-exchanges after flushCache()
 *
 * Group 4 — listActive / listByKind (2 cases)
 *  11. listActive returns only configs with status=active
 *  12. listByKind returns only configs matching the requested kind
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenExchangeStore } from './TokenExchangeStore';
import { RFC_TOKEN_TYPES } from './types';
import type { TokenExchangeConfig } from './types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CRM_CONFIG: TokenExchangeConfig = {
  ref:             'crm-service-token',
  name:            'CRM Service Token',
  kind:            'user-delegated',
  scope:           'crm:read crm:write',
  status:          'active',
  provider:        'openai',
  tokenEndpoint:   'https://auth.example.com/oauth2/token',
  clientId:        'agent-identity-client',
  clientSecret:    'supersecret',
  requestedScopes: ['crm:read', 'crm:write'],
  audience:        'https://crm.example.com',
};

const REVOKED_CONFIG: TokenExchangeConfig = {
  ...CRM_CONFIG,
  ref:    'revoked-slot',
  name:   'Revoked Token',
  status: 'revoked',
};

const ANALYTICS_CONFIG: TokenExchangeConfig = {
  ...CRM_CONFIG,
  ref:  'analytics-token',
  name: 'Analytics Token',
  kind: 'fixed',
};

const ALL_CONFIGS = [CRM_CONFIG, REVOKED_CONFIG, ANALYTICS_CONFIG];

const MOCK_EXCHANGE_RESPONSE = {
  access_token:      'exchanged-jwt-abc123',
  issued_token_type: RFC_TOKEN_TYPES.ACCESS_TOKEN,
  token_type:        'Bearer',
  expires_in:        3600,
  scope:             'crm:read crm:write',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetch(response = MOCK_EXCHANGE_RESPONSE, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  }) as unknown as typeof globalThis.fetch;
}

function makeStore(opts?: {
  configs?: TokenExchangeConfig[];
  subjectToken?: string | null;
  fetchFn?: typeof globalThis.fetch;
}) {
  return new TokenExchangeStore({
    configs:              opts?.configs ?? ALL_CONFIGS,
    subjectTokenProvider: async (_ref) =>
      opts?.subjectToken !== undefined ? opts.subjectToken : 'user-access-token-xyz',
    fetchFn: opts?.fetchFn ?? makeFetch(),
  });
}

// ─── Group 1: findByRef — exchange flow ───────────────────────────────────────

describe('findByRef — exchange flow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null when ref is not found in configs', async () => {
    const store = makeStore();
    const result = await store.findByRef('nonexistent-ref');
    expect(result).toBeNull();
  });

  it('exchanges subject token and returns Credential with access_token as ref', async () => {
    const store = makeStore();
    const cred  = await store.findByRef('crm-service-token');

    expect(cred).not.toBeNull();
    expect(cred!.id).toBe('token-exchange:crm-service-token');
    expect(cred!.ref).toBe('exchanged-jwt-abc123');   // ref = exchanged token
    expect(cred!.kind).toBe('user-delegated');
    expect(cred!.scope).toBe('crm:read crm:write');
    expect(cred!.status).toBe('active');
    expect(cred!.provider).toBe('openai');
  });

  it('sets expiresAt correctly from expires_in', async () => {
    const before    = Date.now();
    const fetchFn   = makeFetch({ ...MOCK_EXCHANGE_RESPONSE, expires_in: 1800 });
    const store     = makeStore({ fetchFn });

    const cred = await store.findByRef('crm-service-token');

    expect(cred?.expiresAt).toBeDefined();
    const expiresAtMs = new Date(cred!.expiresAt!).getTime();
    // expiresAt must be approximately now + 1800 seconds
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 1800 * 1000 + 200);
  });

  it('sends correct RFC 8693 form-encoded body to the token endpoint', async () => {
    const fetchFn = makeFetch();
    const store   = new TokenExchangeStore({
      configs:              [CRM_CONFIG],
      subjectTokenProvider: async () => 'user-subject-token-xyz',
      fetchFn,
    });

    await store.findByRef('crm-service-token');

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as
      [string, RequestInit];

    // Endpoint
    expect(url).toBe('https://auth.example.com/oauth2/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type'])
      .toBe('application/x-www-form-urlencoded');

    // RFC 8693 required parameters
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type'))
      .toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.get('subject_token')).toBe('user-subject-token-xyz');
    expect(body.get('subject_token_type'))
      .toBe(RFC_TOKEN_TYPES.ACCESS_TOKEN);
    expect(body.get('client_id')).toBe('agent-identity-client');
    expect(body.get('client_secret')).toBe('supersecret');
    expect(body.get('scope')).toBe('crm:read crm:write');
    expect(body.get('audience')).toBe('https://crm.example.com');
  });

  it('returns null when subjectTokenProvider returns null', async () => {
    const fetchFn = makeFetch();
    const store   = makeStore({ subjectToken: null, fetchFn });

    const result = await store.findByRef('crm-service-token');

    expect(result).toBeNull();
    // fetch should never be called if there is no subject token
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ─── Group 2: findByRef — resilience ──────────────────────────────────────────

describe('findByRef — resilience', () => {
  it('returns null when token endpoint responds with non-200 status', async () => {
    const fetchFn = makeFetch(MOCK_EXCHANGE_RESPONSE, /* ok= */ false);
    const store   = makeStore({ fetchFn });

    const result = await store.findByRef('crm-service-token');
    expect(result).toBeNull();
  });

  it('returns null without throwing when fetch throws (network error)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(
      new Error('ECONNREFUSED')
    ) as unknown as typeof globalThis.fetch;
    const store = makeStore({ fetchFn });

    await expect(store.findByRef('crm-service-token')).resolves.toBeNull();
  });
});

// ─── Group 3: findByRef — caching ─────────────────────────────────────────────

describe('findByRef — caching', () => {
  it('caches exchanged token — fetch called once for two consecutive findByRef calls', async () => {
    const fetchFn = makeFetch();
    const store   = makeStore({ fetchFn });

    const first  = await store.findByRef('crm-service-token');
    const second = await store.findByRef('crm-service-token');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.ref).toBe(second!.ref);
    // Only one HTTP call despite two findByRef calls
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('re-exchanges after invalidateCache(ref)', async () => {
    const fetchFn = makeFetch();
    const store   = makeStore({ fetchFn });

    await store.findByRef('crm-service-token');  // fills cache
    store.invalidateCache('crm-service-token');  // clears it
    await store.findByRef('crm-service-token');  // re-exchanges

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('re-exchanges after flushCache()', async () => {
    const fetchFn = makeFetch();
    const store   = makeStore({ fetchFn });

    await store.findByRef('crm-service-token');  // fills cache
    store.flushCache();                          // clears all entries
    await store.findByRef('crm-service-token');  // re-exchanges

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// ─── Group 4: listActive / listByKind ─────────────────────────────────────────

describe('listActive and listByKind', () => {
  it('listActive returns only configs with status=active', async () => {
    const store = makeStore();
    const active = await store.listActive();

    // ALL_CONFIGS has 3 entries: crm (active), revoked (revoked), analytics (active)
    expect(active).toHaveLength(2);
    const refs = active.map(c => c.id);
    expect(refs).toContain('token-exchange:crm-service-token');
    expect(refs).toContain('token-exchange:analytics-token');
    expect(refs).not.toContain('token-exchange:revoked-slot');
  });

  it('listByKind returns only configs matching the requested kind', async () => {
    const store = makeStore();

    const userDelegated = await store.listByKind('user-delegated');
    const fixed         = await store.listByKind('fixed');

    // crm is user-delegated, analytics is fixed, revoked is revoked (excluded by listActive)
    expect(userDelegated).toHaveLength(1);
    expect(userDelegated[0].id).toBe('token-exchange:crm-service-token');

    expect(fixed).toHaveLength(1);
    expect(fixed[0].id).toBe('token-exchange:analytics-token');
  });
});
