/**
 * Zero-Trust Credential Attestation — @datacules/agent-identity core
 *
 * Two signer implementations:
 *   - HmacAttestationSigner: symmetric HMAC-SHA256 JWTs (zero deps, fastest)
 *   - AsymmetricAttestationSigner: RS256/ES256 JWTs via Web Crypto (for ID-JAG)
 *
 * Both use Web Crypto API (crypto.subtle) exclusively — available in:
 *   Node.js 18+ (global), browsers, Cloudflare Workers, Deno, Bun.
 * No dynamic imports — compatible with both ESM and CJS builds.
 */
import type { AttestationSigner, AttestationPayload, ResolvedCredential, AgentRequestContext } from './types';

// ─── Shared base64url helpers (module-level; used by both signers) ──────────

/** Encode a UTF-8 string to base64url */
function base64urlEncode(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('base64url');
  }
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Encode an ArrayBuffer to base64url */
function bufToBase64url(buf: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64url');
  }
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decode a base64url string to a Uint8Array */
function base64urlToBuffer(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'base64url');
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decode a base64url body segment to a UTF-8 string */
function base64urlDecodeString(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'base64url').toString('utf8');
  }
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

// ─── HMAC Signer (built-in, zero deps) ───────────────────────────────────

export class HmacAttestationSigner implements AttestationSigner {
  private readonly secret: string;
  private readonly issuer: string;
  private readonly ttlSeconds: number;

  constructor(options: { secret: string; issuer?: string; ttlSeconds?: number }) {
    this.secret = options.secret;
    this.issuer = options.issuer ?? 'agent-identity';
    this.ttlSeconds = options.ttlSeconds ?? 300;
  }

  private async hmacSign(data: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return bufToBase64url(sig);
  }

  async sign(payload: Record<string, unknown>): Promise<string> {
    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64urlEncode(JSON.stringify(payload));
    const sig = await this.hmacSign(`${header}.${body}`);
    return `${header}.${body}.${sig}`;
  }

  async verify(token: string): Promise<Record<string, unknown> | null> {
    try {
      const [header, body, sig] = token.split('.');
      if (!header || !body || !sig) return null;
      const expected = await this.hmacSign(`${header}.${body}`);
      if (expected !== sig) return null;
      return JSON.parse(base64urlDecodeString(body));
    } catch {
      return null;
    }
  }
}

// ─── Asymmetric Signer (RS256 / ES256) ──────────────────────────────────

/**
 * Asymmetric JWT signer/verifier using Web Crypto (RS256 or ES256).
 * Uses only crypto.subtle — no external dependencies.
 *
 * For signing (e.g. minting your own attestations):
 *   const signer = await AsymmetricAttestationSigner.fromKeyPair(privateKey, publicKey, 'RS256');
 *
 * For verification only (e.g. verifying incoming ID-JAGs from JWKS):
 *   const verifier = await AsymmetricAttestationSigner.fromPublicJwk(publicJwk, 'RS256');
 */
export class AsymmetricAttestationSigner implements AttestationSigner {
  private constructor(
    private readonly privateKey: CryptoKey | null,
    private readonly publicKey: CryptoKey,
    private readonly algorithm: 'RS256' | 'ES256',
    private readonly ttlSeconds: number
  ) {}

  // ─── Static factory methods ──────────────────────────────────────────────

  /**
   * Create a signing+verification instance from an already-imported key pair.
   */
  static async fromKeyPair(
    privateKey: CryptoKey,
    publicKey: CryptoKey,
    algorithm: 'RS256' | 'ES256',
    options?: { ttlSeconds?: number }
  ): Promise<AsymmetricAttestationSigner> {
    return new AsymmetricAttestationSigner(
      privateKey,
      publicKey,
      algorithm,
      options?.ttlSeconds ?? 300
    );
  }

  /**
   * Create a verification-only instance from a JSON Web Key.
   * Calling sign() on this instance will throw.
   */
  static async fromPublicJwk(
    jwk: JsonWebKey,
    algorithm: 'RS256' | 'ES256'
  ): Promise<AsymmetricAttestationSigner> {
    const importAlgo =
      algorithm === 'RS256'
        ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        : { name: 'ECDSA', namedCurve: 'P-256' };
    const publicKey = await crypto.subtle.importKey('jwk', jwk, importAlgo, true, ['verify']);
    return new AsymmetricAttestationSigner(null, publicKey, algorithm, 300);
  }

  // ─── Sign / Verify ────────────────────────────────────────────────────────────

  async sign(payload: Record<string, unknown>): Promise<string> {
    if (!this.privateKey) {
      throw new Error(
        'AsymmetricAttestationSigner: no private key — verification-only instance'
      );
    }
    const header = base64urlEncode(
      JSON.stringify({ alg: this.algorithm, typ: 'JWT' })
    );
    const body = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${header}.${body}`;
    const data = new TextEncoder().encode(signingInput);

    const algo =
      this.algorithm === 'RS256'
        ? 'RSASSA-PKCS1-v1_5'
        : ({ name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams);

    const sigBuf = await crypto.subtle.sign(algo, this.privateKey, data);
    const sig = bufToBase64url(sigBuf);
    return `${header}.${body}.${sig}`;
  }

  async verify(token: string): Promise<Record<string, unknown> | null> {
    try {
      const [header, body, sig] = token.split('.');
      if (!header || !body || !sig) return null;

      const signingInput = `${header}.${body}`;
      const data = new TextEncoder().encode(signingInput);
      const sigBytes = base64urlToBuffer(sig);

      const algo =
        this.algorithm === 'RS256'
          ? 'RSASSA-PKCS1-v1_5'
          : ({ name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams);

      const valid = await crypto.subtle.verify(algo, this.publicKey, sigBytes, data);
      if (!valid) return null;

      return JSON.parse(base64urlDecodeString(body));
    } catch {
      return null;
    }
  }
}

// ─── Attestation builder ───────────────────────────────────────────────────

export interface AttestationOptions {
  signer: AttestationSigner;
  issuer?: string;
  ttlSeconds?: number;
  ruleId?: string;
}

export async function buildAttestation(
  ctx: AgentRequestContext,
  resolved: ResolvedCredential,
  options: AttestationOptions
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AttestationPayload = {
    iss: options.issuer ?? 'agent-identity',
    sub: ctx.userId,
    credentialId: resolved.credentialId,
    resolvedFor: resolved.resolvedFor,
    action: ctx.action,
    resourceId: ctx.resourceId,
    traceId: ctx.traceId,
    ruleId: options.ruleId,
    iat: now,
    exp: now + (options.ttlSeconds ?? 300),
  };
  return options.signer.sign(payload as unknown as Record<string, unknown>);
}

// ─── Standalone verifyAttestation helper ──────────────────────────────────

export async function verifyAttestation(
  token: string,
  signer: AttestationSigner
): Promise<AttestationPayload | null> {
  const raw = await signer.verify(token);
  if (!raw) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof raw.exp === 'number' && raw.exp < now) return null;
  return raw as unknown as AttestationPayload;
}
