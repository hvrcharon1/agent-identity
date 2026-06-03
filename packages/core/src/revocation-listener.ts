/**
 * RevocationListener — framework-agnostic inbound revocation handler.
 *
 * The listener does NOT handle JWKS fetching or JWT signature verification —
 * those depend on external libraries. Pass a LogoutJwtVerifier that handles
 * verification for your environment, then wire handleRequest() into your router.
 *
 * Express example:
 *   app.post('/agent/auth/revoke', async (req, res) => {
 *     const result = await listener.handleRequest(req.body, req.headers);
 *     res.status(result.httpStatus).json(result.body);
 *   });
 *
 * Fastify example:
 *   fastify.post('/agent/auth/revoke', async (req, reply) => {
 *     const result = await listener.handleRequest(req.body as string, req.headers);
 *     reply.code(result.httpStatus).send(result.body);
 *   });
 *
 * @module revocation-listener
 */

import { RevocationHandler } from './revocation';
import type { LogoutTokenPayload } from './revocation';

// ─── Public interfaces ───────────────────────────────────────────────────

export interface LogoutJwtVerifier {
  /**
   * Verify a logout+jwt string and return the decoded payload.
   * Return null if the signature is invalid, issuer is untrusted, or token is
   * malformed. Never throw — return null on any error.
   */
  verify(token: string): Promise<LogoutTokenPayload | null>;
}

export interface RevocationListenerOptions {
  handler: RevocationHandler;
  verifier: LogoutJwtVerifier;
}

export interface RevocationListenerResult {
  httpStatus: 200 | 400;
  body: { status: 'ok'; credentialsRevoked: number } | { error: string };
}

// ─── RevocationListener ──────────────────────────────────────────────────

export class RevocationListener {
  constructor(private readonly opts: RevocationListenerOptions) {}

  /**
   * Handle a raw revocation request body and headers.
   *
   * Processing steps:
   *   1. Validate Content-Type contains 'application/logout+jwt'.
   *   2. Call verifier.verify(rawBody) — if null, reject with 400.
   *   3. Call handler.process(payload) — if replay, return 200 with 0 revoked.
   *   4. Return 200 with credentialsRevoked count.
   *
   * @param rawBody  The request body string (the logout+jwt token itself,
   *                 per Content-Type: application/logout+jwt)
   * @param headers  Request headers (for Content-Type validation)
   */
  async handleRequest(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<RevocationListenerResult> {
    // 1. Content-Type validation
    const contentType = headers['content-type'] ?? headers['Content-Type'] ?? '';
    const ctString = Array.isArray(contentType) ? contentType[0] : contentType;
    if (!ctString.includes('application/logout+jwt')) {
      return {
        httpStatus: 400,
        body: { error: 'invalid_content_type' },
      };
    }

    // 2. Signature verification (delegated to caller-supplied verifier)
    const payload = await this.opts.verifier.verify(rawBody);
    if (!payload) {
      return {
        httpStatus: 400,
        body: { error: 'invalid_logout_token' },
      };
    }

    // 3. Process revocation (includes replay detection)
    const result = await this.opts.handler.process(payload);

    // Replay: return 200 with 0 revoked (idempotent)
    if (result.replay) {
      return {
        httpStatus: 200,
        body: { status: 'ok', credentialsRevoked: 0 },
      };
    }

    // 4. Success
    return {
      httpStatus: 200,
      body: { status: 'ok', credentialsRevoked: result.credentialsRevoked },
    };
  }
}
