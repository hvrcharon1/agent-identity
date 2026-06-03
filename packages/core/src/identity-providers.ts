/**
 * ID-JAG verification utilities — validates the claims on a decoded ID-JAG
 * payload against a TrustedProviderRegistry.
 *
 * Signature verification is left to the caller (requires a JWT library or
 * Web Crypto with the provider's JWKS). This module validates claims only.
 *
 * @module identity-providers
 */

import type { TrustedIdentityProvider, TrustedProviderRegistry } from './types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IdJagPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  client_id?: string;
  jti: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  amr?: string[];
  [key: string]: unknown;
}

export type IdJagValidationError =
  | 'issuer_not_trusted'
  | 'provider_disabled'
  | 'expired'
  | 'audience_mismatch'
  | 'missing_verified_identity'
  | 'amr_not_satisfied'
  | 'clock_skew';

export interface IdJagValidationResult {
  valid: boolean;
  provider?: TrustedIdentityProvider;
  error?: IdJagValidationError;
  errorMessage?: string;
}

// ─── validateIdJagClaims ──────────────────────────────────────────────────────

/**
 * Validate ID-JAG claims (NOT signature — that's the caller's responsibility).
 *
 * Steps:
 *   1. Find provider by payload.iss — return issuer_not_trusted if absent.
 *   2. If provider.enabled === false — return provider_disabled.
 *   3. If token is expired (with clock skew tolerance) — return expired.
 *   4. If audience does not include the expected audience — return audience_mismatch.
 *   5. If neither email_verified nor phone_number_verified — return missing_verified_identity.
 *   6. If provider.requiredAmr is set and none of its values appear in payload.amr
 *      — return amr_not_satisfied.
 *   7. Return { valid: true, provider }.
 *
 * @param payload       Decoded JWT payload (signature NOT verified here)
 * @param audience      Expected aud (this service's authorization server URL)
 * @param registry      Configured trusted providers
 * @param nowMs         Current time in ms (injectable for testing; defaults to Date.now())
 * @param clockSkewMs   Accepted clock skew in ms (default: 120_000 = 2 minutes)
 */
export function validateIdJagClaims(
  payload: IdJagPayload,
  audience: string,
  registry: TrustedProviderRegistry,
  nowMs?: number,
  clockSkewMs?: number
): IdJagValidationResult {
  const now = nowMs ?? Date.now();
  const skew = clockSkewMs ?? 120_000;

  // 1. Issuer lookup
  const provider = registry.providers.find((p) => p.issuerUrl === payload.iss);
  if (!provider) {
    return {
      valid: false,
      error: 'issuer_not_trusted',
      errorMessage: `Issuer '${payload.iss}' is not in the trusted provider registry`,
    };
  }

  // 2. Provider enabled check (undefined → enabled)
  if (provider.enabled === false) {
    return {
      valid: false,
      provider,
      error: 'provider_disabled',
      errorMessage: `Provider '${provider.label}' is currently disabled`,
    };
  }

  // 3. Expiry check (exp is in seconds; add clock skew tolerance)
  if (payload.exp * 1000 < now - skew) {
    return {
      valid: false,
      provider,
      error: 'expired',
      errorMessage: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
    };
  }

  // 4. Audience check
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) {
    return {
      valid: false,
      provider,
      error: 'audience_mismatch',
      errorMessage: `Expected audience '${audience}' not found in token aud claim`,
    };
  }

  // 5. Verified identity check — must have at least one verified identity claim
  const hasVerifiedEmail = payload.email_verified === true;
  const hasVerifiedPhone = payload.phone_number_verified === true;
  if (!hasVerifiedEmail && !hasVerifiedPhone) {
    return {
      valid: false,
      provider,
      error: 'missing_verified_identity',
      errorMessage: 'Token must have either email_verified=true or phone_number_verified=true',
    };
  }

  // 6. AMR check
  if (provider.requiredAmr && provider.requiredAmr.length > 0) {
    const tokenAmr = payload.amr ?? [];
    const satisfied = provider.requiredAmr.some((required) => tokenAmr.includes(required));
    if (!satisfied) {
      return {
        valid: false,
        provider,
        error: 'amr_not_satisfied',
        errorMessage: `Required AMR values [${provider.requiredAmr.join(', ')}] not found in token amr: [${tokenAmr.join(', ')}]`,
      };
    }
  }

  // 7. All checks passed
  return { valid: true, provider };
}
