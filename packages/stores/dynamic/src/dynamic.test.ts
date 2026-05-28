/**
 * dynamic.test.ts
 *
 * Tests for DynamicCredentialStore, VaultDynamicProvisioner,
 * and AwsRolesAnywhereProvisioner.
 *
 * All external HTTP calls are mocked via vi.stubGlobal('fetch', ...) so no
 * live Vault / AWS endpoint is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DynamicCredentialStore,
  VaultDynamicProvisioner,
  AwsRolesAnywhereProvisioner,
} from './index';

// ─── Fetch mock helpers ────────────────────────────────────────────────

type MockResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function mockFetch(response: MockResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ''),
    })
  );
}

function mockFetchError(error: Error) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
}

// ─── DynamicCredentialStore ───────────────────────────────────────────────

describe('DynamicCredentialStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  function makeProvisioner() {
    return {
      id: 'test-provisioner',
      provision: vi.fn(async (ref: string) => ({
        leaseId: `lease-${ref}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), // 60s TTL
        secret: 'top-secret',
      })),
      revoke: vi.fn(async () => {}),
    };
  }

  it('findByRef() calls provisioner.provision() and returns a Credential', async () => {
    const provisioner = makeProvisioner();
    const store = new DynamicCredentialStore({ provisioner });

    const cred = await store.findByRef('openai-slot');

    expect(provisioner.provision).toHaveBeenCalledWith('openai-slot');
    expect(cred).not.toBeNull();
    expect(cred?.ref).toBe('lease-openai-slot');
    expect(cred?.status).toBe('active');
    expect(cred?.kind).toBe('fixed');
  });

  it('returns the cached credential on the second call within TTL', async () => {
    const provisioner = makeProvisioner();
    const store = new DynamicCredentialStore({ provisioner, cache: true });

    await store.findByRef('anthropic-slot'); // first call — provisions
    await store.findByRef('anthropic-slot'); // second call — should hit cache

    expect(provisioner.provision).toHaveBeenCalledOnce();
  });

  it('does not cache when cache: false is set', async () => {
    const provisioner = makeProvisioner();
    const store = new DynamicCredentialStore({ provisioner, cache: false });

    await store.findByRef('vault-slot');
    await store.findByRef('vault-slot');

    expect(provisioner.provision).toHaveBeenCalledTimes(2);
  });

  it('re-provisions when cached entry is within renewBeforeExpireSeconds of expiry', async () => {
    const provisioner = makeProvisioner();
    // Expire in 30s, renew threshold 60s → cached entry always triggers re-provision
    provisioner.provision.mockResolvedValue({
      leaseId: 'lease-expiring',
      expiresAt: new Date(Date.now() + 30_000).toISOString(), // only 30s away
      secret: 'secret',
    });
    const store = new DynamicCredentialStore({
      provisioner,
      cache: true,
      renewBeforeExpireSeconds: 60, // 60s > 30s remaining → always re-provisions
    });

    await store.findByRef('near-expiry');
    await store.findByRef('near-expiry'); // cache exists but is within renew window

    expect(provisioner.provision).toHaveBeenCalledTimes(2);
  });

  it('listActive() returns unexpired cached credentials', async () => {
    const provisioner = makeProvisioner();
    const store = new DynamicCredentialStore({ provisioner, cache: true });

    await store.findByRef('cred-a');
    await store.findByRef('cred-b');

    const active = await store.listActive();
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.every((c) => c.status === 'active')).toBe(true);
  });

  it('listByKind() returns only credentials matching the requested kind', async () => {
    const provisioner = makeProvisioner();
    const store = new DynamicCredentialStore({ provisioner, cache: true });
    await store.findByRef('cred-x');

    const fixed = await store.listByKind('fixed');
    const userDelegated = await store.listByKind('user-delegated');

    expect(fixed.length).toBeGreaterThan(0);
    expect(userDelegated).toHaveLength(0);
  });
});

// ─── VaultDynamicProvisioner ──────────────────────────────────────────────

describe('VaultDynamicProvisioner', () => {
  afterEach(() => vi.unstubAllGlobals());

  const VAULT_RESPONSE = {
    lease_id: 'database/creds/crm-readonly/xyz',
    lease_duration: 1800,
    data: { username: 'v-token-abc', password: 's3cr3t' },
  };

  it('hits the correct Vault creds endpoint with the token header', async () => {
    mockFetch({ ok: true, json: async () => VAULT_RESPONSE });

    const provisioner = new VaultDynamicProvisioner({
      vaultAddr: 'http://vault:8200',
      token: 'root-token',
      mount: 'database',
      role: 'crm-readonly',
    });
    await provisioner.provision('any-ref');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://vault:8200/v1/database/creds/crm-readonly',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Vault-Token': 'root-token' }),
      })
    );
  });

  it('returns leaseId, expiresAt, and secret from the Vault response', async () => {
    mockFetch({ ok: true, json: async () => VAULT_RESPONSE });

    const provisioner = new VaultDynamicProvisioner({
      vaultAddr: 'http://vault:8200',
      token: 'root-token',
      mount: 'database',
      role: 'crm-readonly',
    });
    const result = await provisioner.provision('any-ref');

    expect(result.leaseId).toBe(VAULT_RESPONSE.lease_id);
    expect(result.secret).toContain('username');
    // expiresAt should be approximately 1800s from now
    const expiry = new Date(result.expiresAt).getTime();
    expect(expiry).toBeGreaterThan(Date.now() + 1700_000); // > 1700s away
  });

  it('throws when Vault returns a non-OK response', async () => {
    mockFetch({ ok: false, status: 403, text: async () => 'permission denied' });

    const provisioner = new VaultDynamicProvisioner({
      vaultAddr: 'http://vault:8200',
      token: 'bad-token',
      mount: 'database',
      role: 'crm-readonly',
    });

    await expect(provisioner.provision('any-ref')).rejects.toThrow('Vault provision failed: 403');
  });

  it('revoke() calls the Vault lease revocation endpoint', async () => {
    mockFetch({ ok: true, json: async () => ({}) });

    const provisioner = new VaultDynamicProvisioner({
      vaultAddr: 'http://vault:8200',
      token: 'root-token',
      mount: 'database',
      role: 'crm-readonly',
    });
    await provisioner.revoke('database/creds/crm-readonly/xyz');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://vault:8200/v1/sys/leases/revoke',
      expect.objectContaining({ method: 'PUT' })
    );
  });
});

// ─── AwsRolesAnywhereProvisioner ──────────────────────────────────────────

describe('AwsRolesAnywhereProvisioner', () => {
  afterEach(() => vi.unstubAllGlobals());

  const EXPIRATION = new Date(Date.now() + 3_600_000).toISOString();
  const AWS_RESPONSE = {
    credentialSet: [
      {
        credentials: {
          accessKeyId: 'ASIA123',
          secretAccessKey: 'secret456',
          sessionToken: 'token789',
          expiration: EXPIRATION,
        },
      },
    ],
  };

  it('calls the correct AWS Roles Anywhere sessions endpoint', async () => {
    mockFetch({ ok: true, json: async () => AWS_RESPONSE });

    const provisioner = new AwsRolesAnywhereProvisioner({
      profileArn: 'arn:aws:rolesanywhere:us-east-1:123456789:profile/test',
      roleArn: 'arn:aws:iam::123456789:role/test-role',
      trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:123456789:trust-anchor/test',
      region: 'us-east-1',
    });
    await provisioner.provision('any-ref');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://rolesanywhere.us-east-1.amazonaws.com/sessions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns a leaseId, expiresAt from AWS credential expiration', async () => {
    mockFetch({ ok: true, json: async () => AWS_RESPONSE });

    const provisioner = new AwsRolesAnywhereProvisioner({
      profileArn: 'arn:aws:rolesanywhere:us-east-1:123456789:profile/test',
      roleArn: 'arn:aws:iam::123456789:role/test-role',
      trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:123456789:trust-anchor/test',
      region: 'us-east-1',
    });
    const result = await provisioner.provision('any-ref');

    expect(result.leaseId).toMatch(/^aws-session-/);
    expect(result.expiresAt).toBe(EXPIRATION);
    expect(result.secret).toContain('accessKeyId');
  });

  it('throws when AWS Roles Anywhere returns a non-OK response', async () => {
    mockFetch({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const provisioner = new AwsRolesAnywhereProvisioner({
      profileArn: 'arn:aws:rolesanywhere:us-east-1:123456789:profile/test',
      roleArn: 'arn:aws:iam::123456789:role/test-role',
      trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:123456789:trust-anchor/test',
      region: 'us-east-1',
    });

    await expect(provisioner.provision('any-ref')).rejects.toThrow(
      'AWS Roles Anywhere provision failed: 401'
    );
  });
});
