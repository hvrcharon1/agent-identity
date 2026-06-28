/**
 * AgentAuthMdStore.test.ts
 *
 * Tests for AgentAuthMdStore: findByRef(), cache behaviour, registration flows
 * (id-jag, service-auth, verified-email, anonymous), token exchange, claim
 * ceremony polling, and 401 handling.
 *
 * Upstream compat coverage (v0.6.0):
 * ──────────────────────────────────
 * - Discovery field compat (identity_endpoint / register_uri)
 * - No requested_credential_type in registration bodies
 * - identity_assertion → /oauth2/token jwt-bearer exchange
 * - 401 interaction_required → stores ceremony for step-up
 * - RFC 8628-shaped claim polling via pollClaimCeremony()
 * - service_auth top-level type with login_hint
 * - selectMethod() migration across all discovery shapes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAuthMdStore } from './AgentAuthMdStore';
import type { AgentAuthMdConfig, AgentAuthMdStoreOptions, IdJagProvider } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RESOURCE_URL    = 'https://api.example.com';
const AS_URL          = 'https://auth.example.com';
const REGISTER_URI    = `${AS_URL}/agent/register`;
const IDENTITY_EP     = `${AS_URL}/agent/identity`;
const CLAIM_URI       = `${AS_URL}/agent/claim`;
const CLAIM_EP        = `${AS_URL}/agent/claim`;
const TOKEN_EP        = `${AS_URL}/oauth2/token`;

const PRM = {
  resource: RESOURCE_URL,
  authorization_servers: [AS_URL],
};

// ── v0.6.0 fixtures (identity_endpoint, token_endpoint) ─────────────────────

const AS_META_V060_ID_JAG = {
  token_endpoint: TOKEN_EP,
  agent_auth: {
    identity_endpoint: IDENTITY_EP,
    claim_endpoint: CLAIM_EP,
    identity_types_supported: ['id-jag', 'anonymous'],
  },
};

const AS_META_V060_SERVICE_AUTH = {
  token_endpoint: TOKEN_EP,
  agent_auth: {
    identity_endpoint: IDENTITY_EP,
    claim_endpoint: CLAIM_EP,
    identity_types_supported: ['service_auth'],
    service_auth: { credential_types_supported: ['api_key'] },
  },
};

// ── Legacy fixtures (register_uri, no token_endpoint) ────────────────────────

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

const AS_META_SERVICE_AUTH = {
  agent_auth: {
    register_uri: REGISTER_URI,
    claim_uri: CLAIM_URI,
    identity_types_supported: ['service_auth'],
    service_auth: { credential_types_supported: ['api_key'] },
  },
};

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

function mockFetchSequence(...responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[Math.min(idx++, responses.length - 1)];
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 400),
      json: async () => res.body ?? {},
    };
  });
}

function standardFetch(
  asMeta: unknown,
  registrationBody: unknown,
  { registrationOk = true, registrationStatus = registrationOk ? 200 : 400 } = {}
) {
  return mockFetchSequence(
    { ok: true,  body: PRM },
    { ok: true,  body: asMeta },
    { ok: registrationOk, status: registrationStatus, body: registrationBody }
  );
}

/** 4-call mock for v0.6.0 id-jag flow: PRM → AS meta → registration → token exchange. */
function v060IdJagFetch(
  registrationResp: unknown,
  tokenResp: unknown
) {
  return mockFetchSequence(
    { ok: true, body: PRM },
    { ok: true, body: AS_META_V060_ID_JAG },
    { ok: true, body: registrationResp },
    { ok: true, body: tokenResp }
  );
}

// ─── Tests: findByRef() guard cases ────────────────────────────────────────────

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

// ─── Tests: cache ──────────────────────────────────────────────────────────────

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

// ─── Tests: id-jag flow (v0.6.0 with token exchange) ────────────────────────

describe('AgentAuthMdStore.findByRef() — id-jag (v0.6.0 token exchange)', () => {
  it('exchanges identity_assertion at /oauth2/token and returns credential', async () => {
    const fetchFn = v060IdJagFetch(
      { identity_assertion: 'ia-jwt-123', assertion_expires: '2026-07-01T00:00:00Z' },
      { access_token: 'at-exchanged', token_type: 'Bearer', expires_in: 1800 }
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('signed-jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    const cred = await store.findByRef('example-service');

    expect(cred).not.toBeNull();
    expect(cred?.status).toBe('active');
    expect(cred?.ref).toBe('at-exchanged');
    expect(cred?.identityAssertion).toBe('ia-jwt-123');
    expect(fetchFn).toHaveBeenCalledTimes(4);

    // Verify token exchange request
    const [tokenUrl, tokenInit] = fetchFn.mock.calls[3] as [string, RequestInit];
    expect(tokenUrl).toBe(TOKEN_EP);
    expect(tokenInit.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const params = new URLSearchParams(tokenInit.body as string);
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(params.get('assertion')).toBe('ia-jwt-123');
  });

  it('does NOT send requested_credential_type in registration body', async () => {
    const fetchFn = v060IdJagFetch(
      { identity_assertion: 'ia-test' },
      { access_token: 'at', token_type: 'Bearer', expires_in: 3600 }
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('my-jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });
    await store.findByRef('example-service');

    const [registerUrl, registerInit] = fetchFn.mock.calls[2] as [string, RequestInit];
    expect(registerUrl).toBe(IDENTITY_EP);
    const body = JSON.parse(registerInit.body as string) as Record<string, string>;
    expect(body.type).toBe('identity_assertion');
    expect(body.assertion_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(body.assertion).toBe('my-jag');
    expect(body).not.toHaveProperty('requested_credential_type');
  });

  it('handles 401 interaction_required by storing ceremony and returning null', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_ID_JAG },
      {
        ok: false,
        status: 401,
        body: {
          error: 'interaction_required',
          claim_token: 'ct-stepup',
          claim: { user_code: 'ABC-123', verification_uri: 'https://auth.example.com/verify', expires_in: 300, interval: 5 },
        },
      }
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    const cred = await store.findByRef('example-service');
    expect(cred).toBeNull();

    const ceremony = store.getPendingCeremony('example-service');
    expect(ceremony).not.toBeNull();
    expect(ceremony?.user_code).toBe('ABC-123');
    expect(ceremony?.verification_uri).toBe('https://auth.example.com/verify');
  });

  it('handles 401 login_required by returning null (no pending state)', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_ID_JAG },
      { ok: false, status: 401, body: { error: 'login_required', max_age: 300 } }
    );
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    expect(await store.findByRef('example-service')).toBeNull();
    expect(store.getPendingCeremony('example-service')).toBeNull();
  });

  it('returns null when idJagProvider returns null', async () => {
    const fetchFn = mockFetchSequence({ ok: true, body: PRM }, { ok: true, body: AS_META_V060_ID_JAG });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue(null) };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });

  it('returns null when idJagProvider is missing from config', async () => {
    const fetchFn = mockFetchSequence({ ok: true, body: PRM }, { ok: true, body: AS_META_V060_ID_JAG });
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider: undefined })], fetchFn });
    expect(await store.findByRef('example-service')).toBeNull();
  });
});

// ─── Tests: id-jag legacy fallback (pre-v0.2.0 direct access_token) ─────────

describe('AgentAuthMdStore.findByRef() — id-jag legacy (direct access_token)', () => {
  it('uses direct access_token when server has no token_endpoint', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'at-direct', expires_in: 1800 });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('signed-jag') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    const cred = await store.findByRef('example-service');
    expect(cred).not.toBeNull();
    expect(cred?.ref).toBe('at-direct');
    expect(fetchFn).toHaveBeenCalledTimes(3);
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

// ─── Tests: anonymous flow ──────────────────────────────────────────────────

describe('AgentAuthMdStore.findByRef() — anonymous flow', () => {
  it('returns a credential with status=unclaimed from legacy server (direct api_key)', async () => {
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

  it('does NOT send requested_credential_type in anonymous registration', async () => {
    const fetchFn = standardFetch(AS_META_ANONYMOUS, { api_key: 'k', expires_in: 3600 });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.type).toBe('anonymous');
    expect(body).not.toHaveProperty('requested_credential_type');
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

// ─── Tests: verified-email flow (legacy) ─────────────────────────────────────

describe('AgentAuthMdStore.findByRef() — verified-email flow (legacy)', () => {
  it('returns null (claim ceremony required) and stores pending claim info', async () => {
    const fetchFn = standardFetch(AS_META_EMAIL, { claim_token: 'ct-email-001' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['verified-email'], userEmail: 'alice@example.com' })],
      fetchFn,
    });

    const result = await store.findByRef('example-service');
    expect(result).toBeNull();

    const claimFetch = mockFetchSequence({ ok: true });
    store['fetchFn'] = claimFetch;
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

// ─── Tests: service-auth flow (v0.6.0) ──────────────────────────────────────

describe('AgentAuthMdStore.findByRef() — service-auth flow', () => {
  it('returns null (claim ceremony required) when service advertises service_auth', async () => {
    const fetchFn = standardFetch(AS_META_SERVICE_AUTH, { claim_token: 'ct-sa-001' });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'bob@example.com' })],
      fetchFn,
    });
    const result = await store.findByRef('example-service');
    expect(result).toBeNull();
  });

  it('POSTs { type: service_auth, login_hint } without requested_credential_type', async () => {
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
    expect(body).not.toHaveProperty('requested_credential_type');
    expect(body).not.toHaveProperty('assertion_type');
    expect(body).not.toHaveProperty('assertion');
  });

  it('stores pending claim with ceremony from v0.6.0 response', async () => {
    const fetchFn = standardFetch(AS_META_V060_SERVICE_AUTH, {
      claim_token: 'ct-sa-ceremony',
      claim: { user_code: 'XY-456', verification_uri: 'https://auth.example.com/verify', expires_in: 600, interval: 5 },
    });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'carol@example.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const ceremony = store.getPendingCeremony('example-service');
    expect(ceremony).not.toBeNull();
    expect(ceremony?.user_code).toBe('XY-456');
    expect(ceremony?.verification_uri).toBe('https://auth.example.com/verify');
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

// ─── Tests: pollClaimCeremony() ─────────────────────────────────────────────

describe('AgentAuthMdStore.pollClaimCeremony()', () => {
  it('returns null when no pending claim exists', async () => {
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn: vi.fn() });
    expect(await store.pollClaimCeremony('example-service')).toBeNull();
  });

  it('returns null on authorization_pending response', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_SERVICE_AUTH },
      { ok: true, body: { claim_token: 'ct-poll', claim: { user_code: 'A', verification_uri: 'u', expires_in: 300, interval: 5 } } },
      { ok: false, status: 400, body: { error: 'authorization_pending' } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'u@x.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');
    expect(await store.pollClaimCeremony('example-service')).toBeNull();
  });

  it('throws on expired_token response', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_SERVICE_AUTH },
      { ok: true, body: { claim_token: 'ct-exp', claim: { user_code: 'B', verification_uri: 'u', expires_in: 300, interval: 5 } } },
      { ok: false, status: 400, body: { error: 'expired_token' } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'u@x.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');
    await expect(store.pollClaimCeremony('example-service')).rejects.toThrow('claim ceremony expired');
  });

  it('returns credential on successful poll response', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_SERVICE_AUTH },
      { ok: true, body: { claim_token: 'ct-ok', claim: { user_code: 'C', verification_uri: 'u', expires_in: 300, interval: 5 } } },
      { ok: true, body: { access_token: 'at-claimed', token_type: 'Bearer', expires_in: 7200 } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'u@x.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const cred = await store.pollClaimCeremony('example-service');
    expect(cred).not.toBeNull();
    expect(cred?.ref).toBe('at-claimed');
    expect(cred?.status).toBe('active');
    expect(cred?.claimedAt).toBeDefined();

    // Pending cleared
    expect(store.getPendingCeremony('example-service')).toBeNull();
  });

  it('sends correct grant_type and claim_token in poll request', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_V060_SERVICE_AUTH },
      { ok: true, body: { claim_token: 'ct-body-check', claim: { user_code: 'D', verification_uri: 'u', expires_in: 300, interval: 5 } } },
      { ok: true, body: { access_token: 'at-ok', token_type: 'Bearer', expires_in: 3600 } }
    );
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['service-auth'], userEmail: 'u@x.com' })],
      fetchFn,
    });
    await store.findByRef('example-service');
    await store.pollClaimCeremony('example-service');

    const [url, init] = fetchFn.mock.calls[3] as [string, RequestInit];
    expect(url).toBe(TOKEN_EP);
    const params = new URLSearchParams(init.body as string);
    expect(params.get('grant_type')).toBe('urn:workos:agent-auth:grant-type:claim');
    expect(params.get('claim_token')).toBe('ct-body-check');
  });
});

// ─── Tests: selectMethod() migration compatibility ───────────────────────────

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

  it('recognises id-jag nested inside identity_assertion.assertion_types_supported', async () => {
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
  });

  it('recognises verified_email nested inside identity_assertion.assertion_types_supported', async () => {
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

  it('obeys explicit methodPreference to force verified-email on service_auth-capable service', async () => {
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

  it('uses identity_endpoint (v0.6.0) over register_uri when both present', async () => {
    const asMeta = {
      agent_auth: {
        identity_endpoint: IDENTITY_EP,
        register_uri: REGISTER_URI,
        identity_types_supported: ['anonymous'],
        anonymous: { credential_types_supported: ['api_key'] },
      },
    };
    const fetchFn = standardFetch(asMeta, { api_key: 'k', expires_in: 3600 });
    const store = new AgentAuthMdStore({
      configs: [makeConfig({ methodPreference: ['anonymous'] })],
      fetchFn,
    });
    await store.findByRef('example-service');

    const [url] = fetchFn.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(IDENTITY_EP);
  });
});

// ─── Tests: legacy claim ceremony (OTP) ─────────────────────────────────────

describe('AgentAuthMdStore.startClaimCeremony()', () => {
  it('throws when no pending claim exists', async () => {
    const store = new AgentAuthMdStore({ configs: [makeConfig()], fetchFn: vi.fn() });
    await expect(store.startClaimCeremony('example-service'))
      .rejects.toThrow('no pending claim for ref');
  });

  it('throws on non-2xx response from claim endpoint', async () => {
    const fetchFn = mockFetchSequence(
      { ok: true, body: PRM },
      { ok: true, body: AS_META_ANONYMOUS },
      { ok: true, body: { api_key: 'k', expires_in: 3600, claim_token: 'ct-x' } },
      { ok: false }
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
      { ok: false }
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
      { ok: true, body: { access_token: 'claimed-token', expires_in: 7200 } }
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
    expect(await store.completeClaimCeremony('example-service', '111111')).toBeNull();
  });
});

// ─── Tests: revokeByIdentity ────────────────────────────────────────────────

describe('AgentAuthMdStore.revokeByIdentity()', () => {
  it('clears the cache and returns the count of cleared entries', async () => {
    const fetchFn = standardFetch(AS_META_ID_JAG, { access_token: 'tok', expires_in: 3600 });
    const idJagProvider: IdJagProvider = { mintForAudience: vi.fn().mockResolvedValue('j') };
    const store = new AgentAuthMdStore({ configs: [makeConfig({ idJagProvider })], fetchFn });

    await store.findByRef('example-service');
    const count = await store.revokeByIdentity('https://idp.example.com', 'user-x', 'aud');

    expect(count).toBe(1);
    const fetchFn2 = standardFetch(AS_META_ID_JAG, { access_token: 'tok2', expires_in: 3600 });
    store['fetchFn'] = fetchFn2;
    const cred = await store.findByRef('example-service');
    expect(cred?.ref).toBe('tok2');
  });
});

// ─── Tests: listActive / listByKind ─────────────────────────────────────────

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
