/**
 * Zero-Trust Credential Attestation — @datacules/agent-identity core
 *
 * Every resolve() call can sign a short-lived JWT attestation using an
 * HMAC-SHA256 key. Downstream services verify the attestation independently
 * without calling agent-identity again — the proof travels with the request.
 *
 * Uses Web Crypto API (crypto.subtle) exclusively — available in:
 *   Node.js 18+ (global), browsers, Cloudflare Workers, Deno, Bun.
 * No dynamic imports — compatible with both ESM and CJS builds.
 */
import type { AttestationSigner, AttestationPayload, ResolvedCredential, AgentRequestContext } from './types';

// ─── HMAC Signer (built-in, zero deps) ──────────────────────────────────────

export class HmacAttestationSigner implements AttestationSigner {
  private readonly secret: string;
  private readonly issuer: string;
  private readonly ttlSeconds: number;

  constructor(options: { secret: string; issuer?: string; ttlSeconds?: number }) {
    this.secret = options.secret;
    this.issuer = options.issuer ?? 'agent-identity';
    this.ttlSeconds = options.ttlSeconds ?? 300;
  }

  private base64url(input: string): string {
    // Works in both browser and Node 18+ (Buffer is global in Node)
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input).toString('base64url');
    }
    // Browser fallback via btoa
    return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private bufToBase64url(buf: ArrayBuffer): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buf).toString('base64url');
    }
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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
    return this.bufToBase64url(sig);
  }

  async sign(payload: Record<string, unknown>): Promise<string> {
    const header = this.base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64url(JSON.stringify(payload));
    const sig = await this.hmacSign(`${header}.${body}`);
    return `${header}.${body}.${sig}`;
  }

  async verify(token: string): Promise<Record<string, unknown> | null> {
    try {
      const [header, body, sig] = token.split('.');
      if (!header || !body || !sig) return null;
      const expected = await this.hmacSign(`${header}.${body}`);
      if (expected !== sig) return null;
      // Decode body: Node uses Buffer, browsers use atob
      const decoded = typeof Buffer !== 'undefined'
        ? Buffer.from(body, 'base64url').toString('utf8')
        : atob(body.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

// ─── Attestation builder ────────────────────────────────────────────────────

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

// ─── Standalone verifyAttestation helper ────────────────────────────────────

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
