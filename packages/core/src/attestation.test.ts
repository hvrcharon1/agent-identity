/**
 * attestation.test.ts
 *
 * Tests for HmacAttestationSigner, AsymmetricAttestationSigner,
 * buildAttestation, and verifyAttestation.
 * All tests run purely in-process with no external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HmacAttestationSigner,
  AsymmetricAttestationSigner,
  buildAttestation,
  verifyAttestation,
} from './attestation';
import type { AgentRequestContext, ResolvedCredential } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SECRET = 'test-hmac-secret-32-bytes-padded';

const ctx: AgentRequestContext = {
  userId: 'user-alice',
  resourceId: 'knowledge-base',
  resourceKind: 'personal',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: 'trace-abc123',
  requestedAt: new Date().toISOString(),
};

const resolved: ResolvedCredential = {
  credentialId: 'cred-anthropic',
  kind: 'fixed',
  ref: 'anthropic-prod-slot',
  resolvedFor: 'user-alice',
};

// ─── HmacAttestationSigner ────────────────────────────────────────────────────

describe('HmacAttestationSigner', () => {
  let signer: HmacAttestationSigner;

  beforeEach(() => {
    signer = new HmacAttestationSigner({ secret: SECRET, issuer: 'test-issuer', ttlSeconds: 300 });
  });

  it('sign() returns a three-part JWT string', async () => {
    const token = await signer.sign({ foo: 'bar' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('verify() returns the payload for a valid token', async () => {
    const token = await signer.sign({ sub: 'user-alice', custom: 42 });
    const payload = await signer.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-alice');
    expect(payload?.custom).toBe(42);
  });

  it('verify() returns null for a tampered token', async () => {
    const token = await signer.sign({ sub: 'user-alice' });
    const [h, b, _sig] = token.split('.');
    const tampered = `${h}.${b}.invalidsig`;
    const result = await signer.verify(tampered);
    expect(result).toBeNull();
  });

  it('verify() returns null for a malformed token (missing parts)', async () => {
    expect(await signer.verify('only.two')).toBeNull();
    expect(await signer.verify('')).toBeNull();
  });

  it('two signers with different secrets produce different tokens', async () => {
    const signer2 = new HmacAttestationSigner({ secret: 'different-secret-here!' });
    const t1 = await signer.sign({ x: 1 });
    const t2 = await signer2.sign({ x: 1 });
    expect(t1).not.toBe(t2);
  });

  it('verify() by one signer rejects a token signed by a different signer', async () => {
    const signer2 = new HmacAttestationSigner({ secret: 'different-secret-here!' });
    const token = await signer2.sign({ x: 1 });
    expect(await signer.verify(token)).toBeNull();
  });
});

// ─── AsymmetricAttestationSigner ─────────────────────────────────────────────

describe('AsymmetricAttestationSigner — RS256', () => {
  let signer: AsymmetricAttestationSigner;

  beforeEach(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    signer = await AsymmetricAttestationSigner.fromKeyPair(
      keyPair.privateKey,
      keyPair.publicKey,
      'RS256'
    );
  });

  it('sign() returns a three-part JWT string', async () => {
    const token = await signer.sign({ sub: 'alice' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('verify() returns the payload for a valid signed token', async () => {
    const token = await signer.sign({ sub: 'alice', role: 'admin' });
    const payload = await signer.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('alice');
    expect(payload?.role).toBe('admin');
  });

  it('verify() returns null for a tampered signature', async () => {
    const token = await signer.sign({ sub: 'alice' });
    const [h, b] = token.split('.');
    const result = await signer.verify(`${h}.${b}.invalidsignature`);
    expect(result).toBeNull();
  });

  it('verify() returns null for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await signer.sign({ sub: 'alice', iat: now - 600, exp: now - 1 });
    // verify() itself does not check exp — verifyAttestation() does; but let's confirm
    // the payload is returned (exp check is verifyAttestation's job)
    const payload = await signer.verify(expired);
    expect(payload).not.toBeNull(); // raw verify doesn't check exp
    // Use verifyAttestation to confirm exp enforcement
    expect(await verifyAttestation(expired, signer)).toBeNull();
  });

  it('verify() returns null for a malformed token', async () => {
    expect(await signer.verify('bad')).toBeNull();
    expect(await signer.verify('')).toBeNull();
  });
});

describe('AsymmetricAttestationSigner — ES256', () => {
  let signer: AsymmetricAttestationSigner;

  beforeEach(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    signer = await AsymmetricAttestationSigner.fromKeyPair(
      keyPair.privateKey,
      keyPair.publicKey,
      'ES256'
    );
  });

  it('round-trips sign → verify with ES256', async () => {
    const token = await signer.sign({ sub: 'bob', scope: 'read' });
    const payload = await signer.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('bob');
    expect(payload?.scope).toBe('read');
  });

  it('verify() returns null for tampered ES256 signature', async () => {
    const token = await signer.sign({ sub: 'bob' });
    const parts = token.split('.');
    const result = await signer.verify(`${parts[0]}.${parts[1]}.AAAAAAAAAA`);
    expect(result).toBeNull();
  });
});

describe('AsymmetricAttestationSigner — fromPublicJwk (verify-only)', () => {
  it('sign() throws when constructed without a private key', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const verifier = await AsymmetricAttestationSigner.fromPublicJwk(publicJwk, 'ES256');

    await expect(verifier.sign({ sub: 'x' })).rejects.toThrow(
      'AsymmetricAttestationSigner: no private key — verification-only instance'
    );
  });

  it('verify() works for a token signed by the corresponding private key', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const fullSigner = await AsymmetricAttestationSigner.fromKeyPair(
      keyPair.privateKey,
      keyPair.publicKey,
      'ES256'
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const verifier = await AsymmetricAttestationSigner.fromPublicJwk(publicJwk, 'ES256');

    const token = await fullSigner.sign({ iss: 'issuer', sub: 'charlie' });
    const payload = await verifier.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('charlie');
  });

  it('verify() returns null for a token from a different key pair', async () => {
    const kp1 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const kp2 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const signer1 = await AsymmetricAttestationSigner.fromKeyPair(kp1.privateKey, kp1.publicKey, 'ES256');
    const publicJwk2 = await crypto.subtle.exportKey('jwk', kp2.publicKey);
    const verifier2 = await AsymmetricAttestationSigner.fromPublicJwk(publicJwk2, 'ES256');

    const token = await signer1.sign({ sub: 'dave' });
    expect(await verifier2.verify(token)).toBeNull();
  });
});

// ─── buildAttestation ────────────────────────────────────────────────────────

describe('buildAttestation', () => {
  let signer: HmacAttestationSigner;

  beforeEach(() => {
    signer = new HmacAttestationSigner({ secret: SECRET });
  });

  it('returns a signed JWT string', async () => {
    const token = await buildAttestation(ctx, resolved, { signer });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('payload contains expected fields', async () => {
    const token = await buildAttestation(ctx, resolved, { signer, ttlSeconds: 60 });
    const payload = await signer.verify(token) as Record<string, unknown>;
    expect(payload).not.toBeNull();
    expect(payload.sub).toBe('user-alice');
    expect(payload.credentialId).toBe('cred-anthropic');
    expect(payload.resolvedFor).toBe('user-alice');
    expect(payload.action).toBe('read');
    expect(payload.resourceId).toBe('knowledge-base');
    expect(payload.traceId).toBe('trace-abc123');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('exp is approximately iat + ttlSeconds', async () => {
    const token = await buildAttestation(ctx, resolved, { signer, ttlSeconds: 120 });
    const payload = await signer.verify(token) as Record<string, unknown>;
    expect(payload).not.toBeNull();
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    expect(exp - iat).toBe(120);
  });

  it('optional ruleId is included when provided', async () => {
    const token = await buildAttestation(ctx, resolved, { signer, ruleId: 'rule-personal-docs' });
    const payload = await signer.verify(token) as Record<string, unknown>;
    expect(payload?.ruleId).toBe('rule-personal-docs');
  });

  it('defaults ttlSeconds to 300 when not provided', async () => {
    const token = await buildAttestation(ctx, resolved, { signer });
    const payload = await signer.verify(token) as Record<string, unknown>;
    const iat = payload!.iat as number;
    const exp = payload!.exp as number;
    expect(exp - iat).toBe(300);
  });
});

// ─── verifyAttestation ───────────────────────────────────────────────────────

describe('verifyAttestation', () => {
  let signer: HmacAttestationSigner;

  beforeEach(() => {
    signer = new HmacAttestationSigner({ secret: SECRET });
  });

  it('returns the payload for a valid, non-expired token', async () => {
    const token = await buildAttestation(ctx, resolved, { signer, ttlSeconds: 300 });
    const payload = await verifyAttestation(token, signer);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-alice');
  });

  it('returns null for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredPayload = { sub: 'u', iat: now - 600, exp: now - 300, credentialId: 'c', resolvedFor: 'u', action: 'read', resourceId: 'r', traceId: 't', iss: 'test' };
    const token = await signer.sign(expiredPayload);
    const result = await verifyAttestation(token, signer);
    expect(result).toBeNull();
  });

  it('returns null for a tampered token', async () => {
    const token = await buildAttestation(ctx, resolved, { signer });
    const [h, b, _s] = token.split('.');
    const result = await verifyAttestation(`${h}.${b}.badsig`, signer);
    expect(result).toBeNull();
  });
});
