/**
 * federation.test.ts
 *
 * Tests for FederationVerifier and FederationIssuer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FederationVerifier, FederationIssuer } from './federation';
import type { AgentRequestContext, FederationConfig } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ctx: AgentRequestContext = {
  userId: 'user-alice',
  resourceId: 'orders-db',
  resourceKind: 'shared',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: 'trace-fed-001',
  requestedAt: new Date().toISOString(),
};

const federationConfig: FederationConfig = {
  trustedDomains: {
    'acme.com': 'acme-public-key-placeholder',
    'vendor.com': 'vendor-public-key-placeholder',
  },
};

// ─── FederationIssuer ─────────────────────────────────────────────────────────

describe('FederationIssuer', () => {
  let issuer: FederationIssuer;

  beforeEach(() => {
    issuer = new FederationIssuer('acme.com', 'orders-agent');
  });

  it('issueEntry() returns an entry with correct fields', () => {
    const entry = issuer.issueEntry(ctx);
    expect(entry.org).toBe('acme.com');
    expect(entry.userId).toBe('user-alice');
    expect(entry.agentId).toBe('orders-agent');
    expect(entry.issuedAt).toBeDefined();
    expect(typeof entry.signature).toBe('string');
    expect(entry.signature.length).toBeGreaterThan(0);
  });

  it('issueChain() returns a single-entry array', () => {
    const chain = issuer.issueChain(ctx);
    expect(chain).toHaveLength(1);
    expect(chain[0].org).toBe('acme.com');
  });

  it('extendChain() appends a new entry to an existing chain', () => {
    const initial = issuer.issueChain(ctx);
    const vendorIssuer = new FederationIssuer('vendor.com', 'fulfillment-agent');
    const extended = vendorIssuer.extendChain(initial, ctx);
    expect(extended).toHaveLength(2);
    expect(extended[0].org).toBe('acme.com');
    expect(extended[1].org).toBe('vendor.com');
  });

  it('issueEntry() produces non-empty signature', () => {
    const entry = issuer.issueEntry(ctx);
    expect(entry.signature).not.toBe('');
  });

  it('multiple calls to issueChain produce independent arrays', () => {
    const c1 = issuer.issueChain(ctx);
    const c2 = issuer.issueChain(ctx);
    expect(c1).not.toBe(c2); // different references
    expect(c1[0].org).toBe(c2[0].org);
  });
});

// ─── FederationVerifier ───────────────────────────────────────────────────────

describe('FederationVerifier', () => {
  let issuer: FederationIssuer;
  let verifier: FederationVerifier;

  beforeEach(() => {
    issuer = new FederationIssuer('acme.com', 'orders-agent');
    verifier = new FederationVerifier(federationConfig);
  });

  it('returns true for a valid single-entry chain from a trusted domain', () => {
    const chain = issuer.issueChain(ctx);
    expect(verifier.verify(chain)).toBe(true);
  });

  it('returns true for a multi-hop chain from two trusted domains', () => {
    const chain = issuer.issueChain(ctx);
    const vendorIssuer = new FederationIssuer('vendor.com', 'fulfillment-agent');
    const extended = vendorIssuer.extendChain(chain, ctx);
    expect(verifier.verify(extended)).toBe(true);
  });

  it('returns false for an empty chain', () => {
    expect(verifier.verify([])).toBe(false);
  });

  it('returns false when any entry is from an unknown domain', () => {
    const chain = issuer.issueChain(ctx);
    const unknownIssuer = new FederationIssuer('evil.org', 'bad-agent');
    const tainted = unknownIssuer.extendChain(chain, ctx);
    expect(verifier.verify(tainted)).toBe(false);
  });

  it('returns false when an entry has an empty signature', () => {
    const chain = issuer.issueChain(ctx);
    const tampered = [{ ...chain[0], signature: '' }];
    expect(verifier.verify(tampered)).toBe(false);
  });

  it('verifier with empty trustedDomains rejects everything', () => {
    const emptyVerifier = new FederationVerifier({ trustedDomains: {} });
    const chain = issuer.issueChain(ctx);
    expect(emptyVerifier.verify(chain)).toBe(false);
  });
});
