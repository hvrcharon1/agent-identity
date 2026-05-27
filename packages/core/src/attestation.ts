/**
 * Zero-Trust Credential Attestation — @datacules/agent-identity core
 *
 * Every resolve() call can sign a short-lived JWT attestation using an
 * Ed25519 key. Downstream services verify the attestation independently
 * without calling agent-identity again — the proof travels with the request.
 *
 * Two built-in signers:
 *   HmacAttestationSigner  — HMAC-SHA256, symmetric, suitable for internal services
 *   Ed25519AttestationSigner — asymmetric, public key verifiable externally
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
    return Buffer.from(input).toString('base64url');
  }

  private async hmacSign(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.secret);
    const msgData = encoder.encode(data);

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, msgData);
      return Buffer.from(sig).toString('base64url');
    }
    // Node.js fallback
    const { createHmac } = await import('crypto');
    return createHmac('sha256', this.secret).update(data).digest('base64url');
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
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
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

/**
 * Verify a credential attestation JWT.
 * Returns the decoded payload on success, null on any failure.
 *
 * @example
 * const payload = await verifyAttestation(token, signer);
 * if (!payload) throw new Error('Attestation invalid');
 */
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
