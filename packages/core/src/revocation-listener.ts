/**
 * RevocationListener — framework-agnostic inbound revocation/SET handler.
 *
 * Accepts both:
 *   - application/logout+jwt (legacy, pre-v0.6.0)
 *   - application/secevent+jwt (RFC 8935, v0.6.0+)
 *
 * The listener does NOT handle JWKS fetching or JWT signature verification —
 * those depend on external libraries. Pass a SecEventJwtVerifier that handles
 * verification for your environment, then wire handleRequest() into your router.
 *
 * Express example:
 *   app.post('/agent/auth/events', async (req, res) => {
 *     const result = await listener.handleRequest(req.body, req.headers);
 *     res.status(result.httpStatus).send(result.body ?? '');
 *   });
 *
 * @module revocation-listener
 */

import { RevocationHandler } from './revocation';
import type { LogoutTokenPayload } from './revocation';

// ─── Public interfaces ───────────────────────────────────────────────────

/** @deprecated Use SecEventJwtVerifier instead. */
export type LogoutJwtVerifier = SecEventJwtVerifier;

export interface SecEventJwtVerifier {
  /**
   * Verify a secevent+jwt (or logout+jwt) string and return the decoded payload.
   * Return null if the signature is invalid, issuer is untrusted, or token is
   * malformed. Never throw — return null on any error.
   */
  verify(token: string): Promise<LogoutTokenPayload | null>;
}

export interface RevocationListenerOptions {
  handler: RevocationHandler;
  verifier: SecEventJwtVerifier;
}

export interface RevocationListenerResult {
  httpStatus: 200 | 202 | 400;
  body?: { status: 'ok'; credentialsRevoked: number } | { error: string };
}

// ─── Constants ───────────────────────────────────────────────────────────

const ACCEPTED_CONTENT_TYPES = ['application/secevent+jwt', 'application/logout+jwt'];

// ─── RevocationListener ──────────────────────────────────────────────────

export class RevocationListener {
  constructor(private readonly opts: RevocationListenerOptions) {}

  /**
   * Handle a raw revocation request body and headers.
   *
   * Processing steps:
   *   1. Validate Content-Type contains 'application/secevent+jwt' or 'application/logout+jwt'.
   *   2. Call verifier.verify(rawBody) — if null, reject with 400.
   *   3. Call handler.process(payload) — if replay, return 202 (idempotent).
   *   4. Return 202 Accepted with no body (RFC 8935 §2.4).
   *
   * @param rawBody  The request body string (the SET/logout+jwt token itself)
   * @param headers  Request headers (for Content-Type validation)
   */
  async handleRequest(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<RevocationListenerResult> {
    const contentType = headers['content-type'] ?? headers['Content-Type'] ?? '';
    const ctString = Array.isArray(contentType) ? contentType[0] : contentType;

    const isAccepted = ACCEPTED_CONTENT_TYPES.some(ct => ctString.includes(ct));
    if (!isAccepted) {
      return {
        httpStatus: 400,
        body: { error: 'invalid_content_type' },
      };
    }

    const payload = await this.opts.verifier.verify(rawBody);
    if (!payload) {
      return {
        httpStatus: 400,
        body: { error: 'invalid_token' },
      };
    }

    await this.opts.handler.process(payload);

    // RFC 8935 §2.4: 202 Accepted, no body on success
    return { httpStatus: 202 };
  }
}
