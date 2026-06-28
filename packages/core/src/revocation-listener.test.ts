/**
 * revocation-listener.test.ts
 *
 * Tests for RevocationListener.handleRequest().
 * Covers:
 *   1. Valid secevent+jwt → 202 Accepted (RFC 8935 §2.4)
 *   2. Valid logout+jwt (legacy) → 202 Accepted
 *   3. Replay (same jti) → 202 Accepted (idempotent)
 *   4. Wrong Content-Type → 400 invalid_content_type
 *   5. Invalid JWT (verifier returns null) → 400 invalid_token
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevocationListener, type SecEventJwtVerifier, type LogoutJwtVerifier } from './revocation-listener';
import { RevocationHandler, type LogoutTokenPayload } from './revocation';
import type { CredentialStore } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECEVENT_JWT_CT = 'application/secevent+jwt';
const LOGOUT_JWT_CT = 'application/logout+jwt';

function makePayload(jti = 'test-jti-001'): LogoutTokenPayload {
  return {
    iss: 'https://idp.example.com',
    sub: 'user-bob',
    aud: 'https://api.myservice.com',
    jti,
    iat: Math.floor(Date.now() / 1000),
    events: { 'https://schemas.openid.net/secevent/risc/event-type/credential-compromise': {} },
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
  let verifier: SecEventJwtVerifier;
  let listener: RevocationListener;

  beforeEach(() => {
    const store = makeStore(2);
    handler = new RevocationHandler(store);
    verifier = { verify: vi.fn() };
    listener = new RevocationListener({ handler, verifier });
  });

  it('returns 202 Accepted for a valid secevent+jwt', async () => {
    const payload = makePayload();
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('some-set-token', {
      'content-type': SECEVENT_JWT_CT,
    });

    expect(result.httpStatus).toBe(202);
    expect(result.body).toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith('some-set-token');
  });

  it('returns 202 Accepted for a valid logout+jwt (legacy compat)', async () => {
    const payload = makePayload();
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('some-jwt-token', {
      'content-type': LOGOUT_JWT_CT,
    });

    expect(result.httpStatus).toBe(202);
    expect(result.body).toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith('some-jwt-token');
  });

  it('returns 202 on replay (idempotent per RFC 8935)', async () => {
    const payload = makePayload('replay-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    await listener.handleRequest('jwt1', { 'content-type': SECEVENT_JWT_CT });
    const result = await listener.handleRequest('jwt2', { 'content-type': SECEVENT_JWT_CT });

    expect(result.httpStatus).toBe(202);
    expect(result.body).toBeUndefined();
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

  it('returns 400 invalid_token when verifier returns null', async () => {
    vi.mocked(verifier.verify).mockResolvedValue(null);

    const result = await listener.handleRequest('bad-token', {
      'content-type': SECEVENT_JWT_CT,
    });

    expect(result.httpStatus).toBe(400);
    expect(result.body).toEqual({ error: 'invalid_token' });
  });

  it('accepts Content-Type with charset suffix', async () => {
    const payload = makePayload('charset-test-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('token', {
      'content-type': 'application/secevent+jwt; charset=utf-8',
    });
    expect(result.httpStatus).toBe(202);
  });

  it('accepts case-insensitive Content-Type header key', async () => {
    const payload = makePayload('ci-header-jti');
    vi.mocked(verifier.verify).mockResolvedValue(payload);

    const result = await listener.handleRequest('token', {
      'Content-Type': SECEVENT_JWT_CT,
    });
    expect(result.httpStatus).toBe(202);
  });

  it('LogoutJwtVerifier type alias still works for backward compat', () => {
    const v: LogoutJwtVerifier = { verify: vi.fn().mockResolvedValue(null) };
    const l = new RevocationListener({ handler, verifier: v });
    expect(l).toBeInstanceOf(RevocationListener);
  });
});
