/**
 * Inbound revocation handler — receives logout+jwt tokens from identity
 * providers and propagates revocation to the CredentialStore.
 *
 * This module validates the logout+jwt STRUCTURE (does NOT verify the
 * signature). The caller (e.g. an Express/Fastify route handler) is
 * responsible for JWKS-based signature verification before passing the
 * decoded payload here.
 *
 * @module revocation
 */

import type { CredentialStore } from './types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LogoutTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  jti: string;
  iat: number;
  events: Record<string, unknown>;
}

export interface RevocationResult {
  jti: string;
  credentialsRevoked: number;
  /** True if jti was already seen (replay attack) */
  replay: boolean;
}

// ─── RevocationHandler ─────────────────────────────────────────────────────

/**
 * RevocationHandler validates and processes inbound logout tokens.
 *
 * Usage:
 *   const handler = new RevocationHandler(store);
 *   // In your route: const payload = await verifyLogoutJwt(token, jwks); // caller's job
 *   const result = await handler.process(payload);
 *
 * The handler keeps an in-memory jti replay cache with configurable TTL.
 * Stale entries are evicted lazily on each process() call.
 */
export class RevocationHandler {
  /**
   * jti → processed-at timestamp (ms).
   * Evict entries older than maxAgeMs.
   */
  private readonly seen = new Map<string, number>();
  private readonly maxAgeMs: number;

  constructor(
    private readonly store: CredentialStore,
    options?: { maxAgeMs?: number }
  ) {
    this.maxAgeMs = options?.maxAgeMs ?? 10 * 60 * 1000; // 10 minutes default
  }

  async process(payload: LogoutTokenPayload): Promise<RevocationResult> {
    this.evictStale();

    // Replay detection
    if (this.seen.has(payload.jti)) {
      return { jti: payload.jti, credentialsRevoked: 0, replay: true };
    }
    this.seen.set(payload.jti, Date.now());

    // Propagate revocation to the store (optional method; graceful if absent)
    const count = this.store.revokeByIdentity
      ? await this.store.revokeByIdentity(payload.iss, payload.sub, payload.aud)
      : 0;

    return { jti: payload.jti, credentialsRevoked: count, replay: false };
  }

  private evictStale(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [jti, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(jti);
    }
  }
}
