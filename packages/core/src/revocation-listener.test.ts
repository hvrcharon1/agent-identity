/**
 * revocation-listener.test.ts
 *
 * Tests for RevocationListener.handleRequest().
 * Covers all four code paths:
 *   1. Valid logout+jwt → 200 ok with credentialsRevoked count
 *   2. Replay (same jti) → 200 ok with credentialsRevoked: 0
 *   3. Wrong Content-Type → 400 invalid_content_type
 *   4. Invalid JWT (verifier returns null) → 400 invalid_logout_token
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevocationListener, type LogoutJwtVerifier } from './revocation-listener';
import { RevocationHandler, type LogoutTokenPayload } from './revocation';
import type { CredentialStore } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LOGOUT_JWT_CT = 'application/logout+jwt';

function makePayload(jti = 'test-jti-001'): LogoutTokenPayload {
  return {
    iss: 'https://idp.example.com',
    sub: 'user-bob',
    aud: 'https://api.myservice.com',
    jti,
    iat: Math.floor(Date.now() / 1000),
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
  };
}

function makeStore(revokeCount = 1): CredentialStore {
  return {
    findByRef: vi.fn().mockResolvedValue(null),
    listActive: vi.fn().mockResolvedValue([]),
    listByKind: vi.fn().mockResolvedValue([]),
    revokeByIdentity: vi.fn().mockResolvedValue(revokeCount),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RevocationListener.handleRequest()', () => {
  let handler: RevocationHandler;
  let verifier: LogoutJwtVerifier;
  let listener: RevocationListener;

  beforeEach(() => {
    const store = makeStore(2);
    handler = new RevocationHandler(store);
    verifier = { verify: vi.fn() };
    listener = new RevocationListener({ handler, verifier });
  });

  it('returns 200 ok with credentialsRevoked for a valid logout+jwt', async () => {
    const payload = makePayload();
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('some-jwt-token', {
      'content-type': LOGOUT_JWT_CT,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ status: 'ok', credentialsRevoked: 2 });
    expect(verifier.verify).toHaveBeenCalledWith('some-jwt-token');
  });

  it('returns 200 ok with credentialsRevoked: 0 on replay', async () => {
    const payload = makePayload('replay-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    // First call
    await listener.handleRequest('jwt1', { 'content-type': LOGOUT_JWT_CT });
    // Second call with same jti
    const result = await listener.handleRequest('jwt2', { 'content-type': LOGOUT_JWT_CT });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ status: 'ok', credentialsRevoked: 0 });
  });

  it('returns 400 invalid_content_type when Content-Type is missing', async () => {
    const result = await listener.handleRequest('some-token', {});
    expect(result.httpStatus).toBe(400);
    expect(result.body).toEqual({ error: 'invalid_content_type' });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_content_type for wrong Content-Type', async () => {
    const result = await listener.handleRequest('token', {
      'content-type': 'application/json',
    });
    expect(result.httpStatus).toBe(400);
    expect(result.body).toEqual({ error: 'invalid_content_type' });
  });

  it('returns 400 invalid_logout_token when verifier returns null', async () => {
    vi.mocked(verifier.verify).mockResolvedValue(null);

    const result = await listener.handleRequest('bad-token', {
      'content-type': LOGOUT_JWT_CT,
    });

    expect(result.httpStatus).toBe(400);
    expect(result.body).toEqual({ error: 'invalid_logout_token' });
  });

  it('accepts Content-Type with charset suffix', async () => {
    const payload = makePayload('charset-test-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('token', {
      'content-type': 'application/logout+jwt; charset=utf-8',
    });
    expect(result.httpStatus).toBe(200);
  });

  it('accepts case-insensitive Content-Type header key', async () => {
    const payload = makePayload('ci-header-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('token', {
      'Content-Type': LOGOUT_JWT_CT,
    });
    expect(result.httpStatus).toBe(200);
  });
});
