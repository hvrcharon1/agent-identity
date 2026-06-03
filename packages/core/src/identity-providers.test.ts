/**
 * identity-providers.test.ts
 *
 * Tests for validateIdJagClaims().
 * Covers all seven validation steps defined in identity-providers.ts.
 */
import { describe, it, expect } from 'vitest';
import { validateIdJagClaims, type IdJagPayload } from './identity-providers';
import type { TrustedProviderRegistry } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW_MS = Date.now();
const NOW_S = Math.floor(NOW_MS / 1000);
const AUDIENCE = 'https://api.myservice.com';

const REGISTRY: TrustedProviderRegistry = {
  providers: [
    {
      issuerUrl: 'https://auth.openai.com',
      label: 'OpenAI',
      enabled: true,
    },
    {
      issuerUrl: 'https://auth.anthropic.com',
      label: 'Anthropic',
      enabled: false,
    },
    {
      issuerUrl: 'https://auth.mfa-required.com',
      label: 'MFA Required Provider',
      requiredAmr: ['mfa'],
    },
  ],
};

function makePayload(overrides?: Partial<IdJagPayload>): IdJagPayload {
  return {
    iss: 'https://auth.openai.com',
    sub: 'user-alice',
    aud: AUDIENCE,
    jti: 'unique-jti-1',
    iat: NOW_S - 10,
    exp: NOW_S + 3600,
    email: 'alice@example.com',
    email_verified: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateIdJagClaims()', () => {
  it('returns valid: true for a well-formed, trusted ID-JAG', () => {
    const result = validateIdJagClaims(makePayload(), AUDIENCE, REGISTRY, NOW_MS);
    expect(result.valid).toBe(true);
    expect(result.provider?.label).toBe('OpenAI');
    expect(result.error).toBeUndefined();
  });

  // Step 1 — issuer lookup
  it('returns issuer_not_trusted when iss is not in the registry', () => {
    const result = validateIdJagClaims(
      makePayload({ iss: 'https://unknown-idp.com' }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('issuer_not_trusted');
  });

  // Step 2 — provider enabled check
  it('returns provider_disabled when the provider is disabled', () => {
    const result = validateIdJagClaims(
      makePayload({ iss: 'https://auth.anthropic.com' }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('provider_disabled');
    expect(result.provider?.label).toBe('Anthropic');
  });

  // Step 3 — expiry check
  it('returns expired when the token is past its exp', () => {
    const result = validateIdJagClaims(
      makePayload({ exp: NOW_S - 300 }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('accepts a token within clock skew tolerance (default 2 min)', () => {
    // exp is 60 seconds in the past but within the 120s default skew
    const result = validateIdJagClaims(
      makePayload({ exp: NOW_S - 60 }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a token just outside the clock skew window', () => {
    const result = validateIdJagClaims(
      makePayload({ exp: NOW_S - 121 }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  // Step 4 — audience mismatch
  it('returns audience_mismatch when aud does not include expected audience', () => {
    const result = validateIdJagClaims(
      makePayload({ aud: 'https://other-service.com' }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('audience_mismatch');
  });

  it('accepts an array aud that includes the expected audience', () => {
    const result = validateIdJagClaims(
      makePayload({ aud: ['https://other.com', AUDIENCE] }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(true);
  });

  // Step 5 — verified identity
  it('returns missing_verified_identity when neither email_verified nor phone_number_verified', () => {
    const result = validateIdJagClaims(
      makePayload({ email_verified: false, phone_number_verified: false }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_verified_identity');
  });

  it('accepts a token with phone_number_verified: true (no email_verified)', () => {
    const result = validateIdJagClaims(
      makePayload({ email_verified: false, phone_number_verified: true }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(true);
  });

  it('returns missing_verified_identity when verified fields are absent', () => {
    const payload = makePayload();
    delete payload.email_verified;
    const result = validateIdJagClaims(payload, AUDIENCE, REGISTRY, NOW_MS);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('missing_verified_identity');
  });

  // Step 6 — AMR check
  it('returns amr_not_satisfied when provider requires MFA but token has no amr', () => {
    const result = validateIdJagClaims(
      makePayload({ iss: 'https://auth.mfa-required.com', amr: [] }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('amr_not_satisfied');
  });

  it('returns amr_not_satisfied when amr is missing entirely', () => {
    const payload = makePayload({ iss: 'https://auth.mfa-required.com' });
    delete payload.amr;
    const result = validateIdJagClaims(payload, AUDIENCE, REGISTRY, NOW_MS);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('amr_not_satisfied');
  });

  it('accepts a token satisfying the required AMR', () => {
    const result = validateIdJagClaims(
      makePayload({ iss: 'https://auth.mfa-required.com', amr: ['pwd', 'mfa'] }),
      AUDIENCE,
      REGISTRY,
      NOW_MS
    );
    expect(result.valid).toBe(true);
    expect(result.provider?.label).toBe('MFA Required Provider');
  });

  // Custom clock skew
  it('respects a custom clockSkewMs of 0', () => {
    const result = validateIdJagClaims(
      makePayload({ exp: NOW_S - 1 }),
      AUDIENCE,
      REGISTRY,
      NOW_MS,
      0
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });
});
