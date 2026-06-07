/**
 * AgentAuthMdStore.test.ts
 *
 * Tests for AgentAuthMdStore: findByRef(), cache behaviour, registration flows
 * (id-jag, service-auth, verified-email, anonymous), and claim ceremony methods.
 * All network calls are mocked via vi.fn().
 *
 * Upstream compat coverage
 * ─────────────────────────
 * The 'selectMethod() migration compat' suite validates that the store handles
 * all three discovery response shapes produced by auth.md servers:
 *   - Simplified shorthands (used by test mocks and simple servers)
 *   - Real spec structure with 'identity_assertion' nesting (pre-PR#15)
 *   - Post-PR#15 structure with top-level 'service_auth'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAuthMdStore } from './AgentAuthMdStore';
import type { AgentAuthMdConfig, AgentAuthMdStoreOptions, IdJagProvider } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RESOURCE_URL = 'https://api.example.com';
const AS_URL       = 'https://auth.example.com';
const REGISTER_URI = `${AS_URL}/agent/register`;
const CLAIM_URI    = `${AS_URL}/agent/claim`;

const PRM = {
  resource: RESOURCE_URL,
  authorization_servers: [AS_URL],
};

// ── Pre-existing fixtures (simplified shorthand shape) ────────────────────────

const AS_META_ID_JAG = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['id-jag', 'anonymous'],
  },
};

const AS_META_ANONYMOUS = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['anonymous'],
    anonymous: { credential_types_supported: ['api_key'] },
  },
};

const AS_META_EMAIL = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['verified_email'],
  },
};

// ── Post-PR#15 fixtures ───────────────────────────────────────────────────────

/** Service advertising only the new service_auth type (post-PR#15). */
const AS_META_SERVICE_AUTH = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['service_auth'],
    service_auth: { credential_types_supported: ['api_key'] },
  },
};

/** Service advertising both id-jag (via identity_assertion) and service_auth (post-PR#15). */
const AS_META_ID_JAG_AND_SERVICE_AUTH = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['identity_assertion', 'service_auth', 'anonymous'],
    identity_assertion: {
      assertion_types_supported: ['urn:ietf:params:oauth:token-type:id-jag'],
      credential_types_supported: ['access_token', 'api_key'],
    },
    service_auth: { credential_types_supported: ['api_key'] },
    anonymous: { credential_types_supported: ['api_key'] },
  },
};

/**
 * Service using the real spec structure with 'identity_assertion' nesting
 * both id-jag and verified_email (pre-PR#15 but spec-compliant).
 */
const AS_META_IDENTITY_ASSERTION_FULL = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['identity_assertion', 'anonymous'],
    identity_assertion: {
      assertion_types_supported: [
        'urn:ietf:params:oauth:token-type:id-jag',
        'verified_email',
      ],
      credential_types_supported: ['access_token', 'api_key'],
    },
    anonymous: { credential_types_supported: ['api_key'] },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AgentAuthMdConfig>): AgentAuthMdConfig {
  return {
    ref: 'example-service',
    kind: 'fixed',
    name: 'Example Service',
    scope: 'read',
    status: 'active',
    resourceServerUrl: RESOURCE_URL,
    methodPreference: ['id-jag', 'anonymous'],
    ...overrides,
  };
}

/**
 * Build a mock fetch that returns responses in sequence.
 * The last response is repeated for any extra calls.
 */
function mockFetchSequence(...responses: Array<{ ok: boolean; body?: unknown }>) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[Math.min(idx++, responses.length - 1)];
    return {
      ok: res.ok,
      status: res.ok ? 200 : 400,
      json: async () => res.body ?? {},
    };
  });
}

/** Standard 3-call mock: PRM → AS meta → registration. */
function standardFetch(
  asMeta: unknown,
  registrationBody: unknown,
  { registrationOk = true } = {}
) {
  return mockFetchSequence(
    { ok: true,  body: PRM },
    { ok: true,  body: asMeta },
    { ok: registrationOk, body: registrationBody }
  );
}

// ─── Tests: findByRef() ────────────────────────────────────────────────────────

describe('AgentAuthMdStore.findByRef() — guard cases', () => {
  it('returns null for an unknown ref', async () => {
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn: vi.fn() });
    expect(await store.findByRef('no-such-ref')).toBeNull();
  });

  it('returns null for a non-active config', async () => {
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ status: 'revoked' })],
      fetchFn: vi.fn(),
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when discovery fails (PRM returns 404)', async () => {
    const fetchFn = mockFetchSequence({ ok: false });
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when no supported method matches preference', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: { agent_auth: { register_uri: REGISTER_URI, identity_types_supported: ['verified_email'] } } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['id-jag'] })],
      fetchFn,
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

describe('AgentAuthMdStore.findByRef() — cache', () => {
  it('returns the cached credential when cache is fresh', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'tok-123', expires_in: 3600 });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('id-jag-token') };
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ idJagProvider })],
      fetchFn,
    });

    const first  = await store.findByRef('example-service');
    const second = await store.findByRef('example-service');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.ref).toBe('tok-123');
    // fetch called 3 times on first call; NOT called again for the cache hit
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('re-registers after invalidateCache()', async () => {
    const regBody = { access_token: 'tok-abc', expires_in: 3600 };
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ID_JAG },
      { ok: true, body: regBody },
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ID_JAG },
      { ok: true, body: regBody },
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('id-jag-jwt') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    await store.findByRef('example-service');
    store.invalidateCache('example-service');
    await store.findByRef('example-service');

    // 3 calls first time + 3 calls second time = 6
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('re-registers for all refs after flushCache()', async () => {
    const regBody = { access_token: 'tok-flush', expires_in: 3600 };
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ID_JAG },
      { ok: true, body: regBody },
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ID_JAG },
      { ok: true, body: regBody },
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('j') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    await store.findByRef('example-service');
    store.flushCache();
    await store.findByRef('example-service');

    expect(fetchFn).toHaveBeenCalledTimes(6);
  });
});

describe('AgentAuthMdStore.findByRef() — id-jag flow', () => {
  it('returns a credential with status=active and ref=access_token', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'at-xyz', expires_in: 1800 });
    const idJagProvider: IdJagProvider = {
      mintForAudience: vi.fn().mockResolvedValue('signed-id-jag'),
    };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    const cred = await store.findByRef('example-service');

    expect(cred).not.toBeNull();
    expect(cred?.status).toBe('active');
    expect(cred?.ref).toBe('at-xyz');
    expect(cred?.kind).toBe('fixed');
    expect(idJagProvider.mintForAudience).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('POSTs the correct id-jag body to register_uri', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'tok', expires_in: 3600 });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('my-jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    await store.findByRef('example-service');

    const [registerUrl, registerInit] = fetchFn.mock.calls[2] as [string, RequestInit];
    expect(registerUrl).toBe(REGISTER_URI);
    expect(registerInit.method).toBe('POST');
    const body = JSON.parse(registerInit.body as string) as Record<string, string>;
    expect(body.type).toBe('identity_assertion');
    expect(body.assertion_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(body.assertion).toBe('my-jag');
    expect(body.requested_credential_type).toBe('access_token');
  });

  it('returns null when idJagProvider returns null', async () => {
    const fetchFn = mockFetchSequence({ ok: true, body: PRM }, { ok: true, body: AS_META_ID_JAG });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue(null) };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when idJagProvider is missing from config', async () => {
    const fetchFn = mockFetchSequence({ ok: true, body: PRM }, { ok: true, body: AS_META_ID_JAG });
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider: undefined })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when registration returns non-2xx', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, {}, { registrationOk: false });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('j') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when registration response has no token', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { message: 'no token here' });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('j') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

describe('AgentAuthMdStore.findByRef() — anonymous flow', () => {
  it('returns a credential with status=unclaimed', async () => {
    const fetchFn = standardFetch(
      AS_META_ANONYMOUS,
      { api_key: 'anon-key', expires_in: 3600, claim_token: 'ct-abc', scopes: ['read'], post_claim_scopes: ['read', 'write'] }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });

    const cred = await store.findByRef('example-service');

    expect(cred?.status).toBe('unclaimed');
    expect(cred?.ref).toBe('anon-key');
    expect(cred?.preClaimScopes).toEqual(['read']);
    expect(cred?.postClaimScopes).toEqual(['read', 'write']);
    expect(cred?.claimToken).toBe('ct-abc');
  });

  it('POSTs { type: anonymous, requested_credential_type: api_key }', async () => {
    const fetchFn = standardFetch(AS_META_ANONYMOUS, { api_key: 'k', expires_in: 3600 });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('anonymous');
    expect(body.requested_credential_type).toBe('api_key');
  });

  it('returns null on non-2xx anonymous registration', async () => {
    const fetchFn = standardFetch(AS_META_ANONYMOUS, {}, { registrationOk: false });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

describe('AgentAuthMdStore.findByRef() — verified-email flow (legacy)', () => {
  it('returns null (claim ceremony required) and stores pending claim info', async () => {
    const fetchFn = standardFetch(AS_META_EMAIL, { claim_token: 'ct-email-001' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['verified-email'], userEmail: 'alice@example.com' })],
      fetchFn,
    });

    const result = await store.findByRef('example-service');
    expect(result).toBeNull(); // claim ceremony required

    // startClaimCeremony should now work (pending claim is stored)
    const claimFetch = mockFetchSequence({ ok: true });
    store['fetchFn'] = claimFetch; // swap fetch for ceremony
    const token = await store.startClaimCeremony('example-service');
    expect(token).toBe('ct-email-001');
  });

  it('returns null when userEmail is missing from config', async () => {
    const fetchFn = mockFetchSequence({ ok: true, body: PRM }, { ok: true, body: AS_META_EMAIL });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['verified-email'], userEmail: undefined })],
      fetchFn,
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

// ─── Tests: service-auth flow (auth.md PR #15) ────────────────────────────────

describe('AgentAuthMdStore.findByRef() — service-auth flow (auth.md PR #15)', () => {
  it('returns null (claim ceremony required) when service advertises service_auth', async () => {
    const fetchFn = standardFetch(AS_META_SERVICE_AUTH, { claim_token: 'ct-sa-001' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'bob@example.com' })],
      fetchFn,
    });
    const result = await store.findByRef('example-service');
    expect(result).toBeNull();
  });

  it('POSTs { type: service_auth, login_hint } to register_uri', async () => {
    const fetchFn = standardFetch(AS_META_SERVICE_AUTH, { claim_token: 'ct-sa-002' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'bob@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [registerUrl, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    expect(registerUrl).toBe(REGISTER_URI);
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('service_auth');
    expect(body.login_hint).toBe('bob@example.com');
    expect(body.requested_credential_type).toBe('api_key');
    // Must NOT send the old assertion_type field
    expect(body.assertion_type).toBeUndefined();
    expect(body.assertion).toBeUndefined();
  });

  it('stores pending claim so startClaimCeremony() works after service_auth registration', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_SERVICE_AUTH },
      { ok: true, body: { claim_token: 'ct-sa-003' } },
      { ok: true }, // startClaimCeremony POST
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'carol@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');
    const token = await store.startClaimCeremony('example-service');
    expect(token).toBe('ct-sa-003');
  });

  it('returns null when userEmail is missing for service-auth', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_SERVICE_AUTH },
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: undefined })],
      fetchFn,
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null on non-2xx service_auth registration response', async () => {
    const fetchFn = standardFetch(AS_META_SERVICE_AUTH, {}, { registrationOk: false });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'dave@example.com' })],
      fetchFn,
    });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

// ─── Tests: selectMethod() migration compatibility ─────────────────────────────

describe('AgentAuthMdStore — selectMethod() migration compatibility', () => {
  it('prefers service_auth over verified_email when both are in default preference', async () => {
    const asMeta = {
      agent_auth: {
        register_uri: REGISTER_URI,
        claim_uri: CLAIM_URI,
        identity_types_supported: ['service_auth', 'verified_email', 'anonymous'],
      },
    };
    const fetchFn = standardFetch(asMeta, { claim_token: 'ct-prefer-sa' });
    const store = new AgentAuthMdStore({
      // Default preference: ['id-jag', 'service-auth', 'verified-email', 'anonymous']
      configs: [makeConfig({ methodPreference: undefined, userEmail: 'eve@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('service_auth');
    expect(body.login_hint).toBe('eve@example.com');
  });

  it('falls back to verified-email for legacy services (only verified_email, no service_auth)', async () => {
    const fetchFn = standardFetch(AS_META_EMAIL, { claim_token: 'ct-legacy' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: undefined, userEmail: 'frank@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('identity_assertion');
    expect(body.assertion_type).toBe('verified_email');
    expect(body.assertion).toBe('frank@example.com');
  });

  it('recognises id-jag nested inside identity_assertion.assertion_types_supported (real spec structure)', async () => {
    const fetchFn = standardFetch(
      AS_META_IDENTITY_ASSERTION_FULL,
      { access_token: 'tok-nested-idjag', expires_in: 3600 }
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('nested-jag') };
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ idJagProvider })],
      fetchFn,
    });
    const cred = await store.findByRef('example-service');
    expect(cred).not.toBeNull();
    expect(cred?.ref).toBe('tok-nested-idjag');
    expect(idJagProvider.mintForAudience).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('recognises verified_email nested inside identity_assertion.assertion_types_supported (real spec structure)', async () => {
    // Config has no idJagProvider so id-jag is skipped; verified-email is next
    const fetchFn = standardFetch(AS_META_IDENTITY_ASSERTION_FULL, { claim_token: 'ct-nested-ve' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['verified-email'], userEmail: 'grace@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('identity_assertion');
    expect(body.assertion_type).toBe('verified_email');
  });

  it('obeys explicit methodPreference to force verified-email on a service_auth-capable service', async () => {
    const asMeta = {
      agent_auth: {
        register_uri: REGISTER_URI,
        claim_uri: CLAIM_URI,
        identity_types_supported: ['service_auth', 'verified_email'],
      },
    };
    const fetchFn = standardFetch(asMeta, { claim_token: 'ct-forced-ve' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({
        methodPreference: ['verified-email'],
        userEmail: 'henry@example.com',
      })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('identity_assertion');
    expect(body.assertion_type).toBe('verified_email');
    expect(body.assertion).toBe('henry@example.com');
  });
});

// ─── Tests: claim ceremony ──────────────────────────────────────────────────

describe('AgentAuthMdStore.startClaimCeremony()', () => {
  it('throws when no pending claim exists', async () => {
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn: vi.fn() });
    await expect(store.startClaimCeremony('example-service'))
      .rejects.toThrow('no pending claim for ref');
  });

  it('throws on non-2xx response from claim_uri', async () => {
    // Seed a pending claim directly (testing private state via anonymous flow)
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ANONYMOUS },
      { ok: true, body: { api_key: 'k', expires_in: 3600, claim_token: 'ct-x' } }, // registration
      { ok: false } // startClaimCeremony call
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');
    await expect(store.startClaimCeremony('example-service'))
      .rejects.toThrow('startClaimCeremony failed');
  });
});

describe('AgentAuthMdStore.completeClaimCeremony()', () => {
  it('returns null when no pending claim exists', async () => {
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn: vi.fn() });
    expect(await store.completeClaimCeremony('example-service', '123456')).toBeNull();
  });

  it('returns null on non-2xx response', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ANONYMOUS },
      { ok: true, body: { api_key: 'k', expires_in: 3600, claim_token: 'ct-y' } },
      { ok: false } // completeClaimCeremony
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');
    expect(await store.completeClaimCeremony('example-service', 'otp')).toBeNull();
  });

  it('returns a credential with status=active and claimedAt set on success', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ANONYMOUS },
      { ok: true, body: { api_key: 'anon-k', expires_in: 3600, claim_token: 'ct-z' } },
      { ok: true, body: { access_token: 'claimed-token', expires_in: 7200 } } // complete
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const cred = await store.completeClaimCeremony('example-service', '999999');
    expect(cred).not.toBeNull();
    expect(cred?.status).toBe('active');
    expect(cred?.ref).toBe('claimed-token');
    expect(cred?.claimedAt).toBeDefined();
  });

  it('clears the pending claim entry after a successful ceremony', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ANONYMOUS },
      { ok: true, body: { api_key: 'k', expires_in: 3600, claim_token: 'ct-w' } },
      { ok: true, body: { access_token: 'final-tok', expires_in: 3600 } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');
    await store.completeClaimCeremony('example-service', '000000');

    // No pending claim left — second complete should return null
    expect(await store.completeClaimCeremony('example-service', '111111')).toBeNull();
  });
});

// ─── Tests: revokeByIdentity ──────────────────────────────────────────────────

describe('AgentAuthMdStore.revokeByIdentity()', () => {
  it('clears the cache and returns the count of cleared entries', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'tok', expires_in: 3600 });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('j') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    await store.findByRef('example-service'); // populates cache
    const count = await store.revokeByIdentity('https://idp.example.com', 'user-x', 'aud');

    expect(count).toBe(1);
    // Cache should be empty; next findByRef triggers re-registration
    const fetchFn2 = standardFetch(AS_META_ID_JAG, { access_token: 'tok2', expires_in: 3600 });
    store['fetchFn'] = fetchFn2;
    const cred = await store.findByRef('example-service');
    expect(cred?.ref).toBe('tok2');
  });
});

// ─── Tests: listActive / listByKind ──────────────────────────────────────────

describe('AgentAuthMdStore list methods', () => {
  it('listActive() returns all active configs as placeholder credentials', async () => {
    const store = new AgentAuthMdStore({
      configs: [
        makeConfig({ ref: 'svc-a', status: 'active' }),
        makeConfig({ ref: 'svc-b', status: 'revoked' }),
        makeConfig({ ref: 'svc-c', status: 'active', kind: 'user-delegated' }),
      ],
      fetchFn: vi.fn(),
    });
    const active = await store.listActive();
    expect(active).toHaveLength(2);
    expect(active.map(c => c.id)).toEqual(expect.arrayContaining(['authmd:svc-a', 'authmd:svc-c']));
  });

  it('listByKind() filters by credential kind', async () => {
    const store = new AgentAuthMdStore({
      configs: [
        makeConfig({ ref: 'f1', kind: 'fixed' }),
        makeConfig({ ref: 'ud1', kind: 'user-delegated' }),
      ],
      fetchFn: vi.fn(),
    });
    const fixed = await store.listByKind('fixed');
    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.id).toBe('authmd:f1');
  });
});
