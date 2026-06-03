/**
 * revocation.test.ts
 *
 * Tests for RevocationHandler: process(), replay detection, jti eviction,
 * and graceful handling of stores that do not implement revokeByIdentity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevocationHandler } from './revocation';
import type { LogoutTokenPayload } from './revocation';
import type { CredentialStore } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayload(overrides?: Partial<LogoutTokenPayload>): LogoutTokenPayload {
  return {
    iss: 'https://idp.example.com',
    sub: 'user-alice',
    aud: 'https://api.myservice.com',
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    iat: Math.floor(Date.now() / 1000),
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    ...overrides,
  };
}

function makeStore(revokeCount = 2): CredentialStore {
  return {
    findByRef: vi.fn().mockResolvedValue(null),
    listActive: vi.fn().mockResolvedValue([]),
    listByKind: vi.fn().mockResolvedValue([]),
    revokeByIdentity: vi.fn().mockResolvedValue(revokeCount),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RevocationHandler.process()', () => {
  it('calls revokeByIdentity on the store and returns credentialsRevoked', async () => {
    const store = makeStore(3);
    const handler = new RevocationHandler(store);
    const payload = makePayload();

    const result = await handler.process(payload);

    expect(result.replay).toBe(false);
    expect(result.credentialsRevoked).toBe(3);
    expect(result.jti).toBe(payload.jti);
    expect(store.revokeByIdentity).toHaveBeenCalledWith(
      payload.iss,
      payload.sub,
      payload.aud
    );
  });

  it('returns credentialsRevoked: 0 when store has no revokeByIdentity method', async () => {
    const store: CredentialStore = {
      findByRef: vi.fn().mockResolvedValue(null),
      listActive: vi.fn().mockResolvedValue([]),
      listByKind: vi.fn().mockResolvedValue([]),
      // revokeByIdentity intentionally omitted
    };
    const handler = new RevocationHandler(store);
    const result = await handler.process(makePayload());
    expect(result.replay).toBe(false);
    expect(result.credentialsRevoked).toBe(0);
  });

  it('returns replay: true on the second call with the same jti', async () => {
    const store = makeStore(1);
    const handler = new RevocationHandler(store);
    const payload = makePayload({ jti: 'fixed-jti-replay-test' });

    const first = await handler.process(payload);
    expect(first.replay).toBe(false);

    const second = await handler.process(payload);
    expect(second.replay).toBe(true);
    expect(second.credentialsRevoked).toBe(0);

    // revokeByIdentity must only be called once (not on replay)
    expect(store.revokeByIdentity).toHaveBeenCalledTimes(1);
  });

  it('different jtis are processed independently', async () => {
    const store = makeStore(1);
    const handler = new RevocationHandler(store);

    const r1 = await handler.process(makePayload({ jti: 'jti-A' }));
    const r2 = await handler.process(makePayload({ jti: 'jti-B' }));

    expect(r1.replay).toBe(false);
    expect(r2.replay).toBe(false);
    expect(store.revokeByIdentity).toHaveBeenCalledTimes(2);
  });
});

describe('RevocationHandler — jti eviction', () => {
  it('re-processes a jti after its TTL has expired', async () => {
    const store = makeStore(1);
    // Short maxAgeMs so the entry expires quickly
    const handler = new RevocationHandler(store, { maxAgeMs: 1 });
    const payload = makePayload({ jti: 'eviction-test-jti' });

    const first = await handler.process(payload);
    expect(first.replay).toBe(false);

    // Wait for the TTL to expire
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    // The jti should be evicted; this should NOT be flagged as replay
    const second = await handler.process(payload);
    expect(second.replay).toBe(false);
    expect(store.revokeByIdentity).toHaveBeenCalledTimes(2);
  });
});
