/**
 * Agent Federation — Cross-Org Identity Chains
 *
 * Carries a signed IdentityChain token across trust boundaries so that
 * the full principal history is verifiable at every hop.
 *
 * Feature #11 from FEATURE_SUGGESTIONS.md
 */
import type { FederationConfig, IdentityChainEntry, AgentRequestContext } from './types';

// ─── FederationVerifier ───────────────────────────────────────────────────────

export class FederationVerifier {
  constructor(private readonly config: FederationConfig) {}

  /**
   * Verify every entry in the chain against the registered public key for
   * that entry's trust domain.
   *
   * Returns true only if every entry has a valid, non-tampered signature.
   * In production, replace the placeholder comparison with real Ed25519
   * verification against the registered public key.
   */
  verify(chain: IdentityChainEntry[]): boolean {
    if (!chain || chain.length === 0) return false;
    for (const entry of chain) {
      const trustedKey = this.config.trustedDomains[entry.org];
      if (!trustedKey) return false;
      // Structural check — production impl would verify Ed25519 signature
      if (!entry.signature || entry.signature.length === 0) return false;
    }
    return true;
  }
}

// ─── FederationIssuer ─────────────────────────────────────────────────────────

export class FederationIssuer {
  constructor(
    private readonly trustDomain: string,
    private readonly agentId: string
  ) {}

  /**
   * Issue a new identity chain entry for the current request context.
   * In production, replace the placeholder signature with a real Ed25519
   * signature using the deployment's private key.
   */
  issueEntry(ctx: AgentRequestContext): IdentityChainEntry {
    const entry: IdentityChainEntry = {
      org: this.trustDomain,
      userId: ctx.userId,
      agentId: this.agentId,
      issuedAt: new Date().toISOString(),
      // Placeholder — replace with Ed25519 signing in production
      signature: Buffer.from(
        JSON.stringify({ org: this.trustDomain, userId: ctx.userId, agentId: this.agentId })
      ).toString('base64'),
    };
    return entry;
  }

  /**
   * Start a new chain from this agent.
   */
  issueChain(ctx: AgentRequestContext): IdentityChainEntry[] {
    return [this.issueEntry(ctx)];
  }

  /**
   * Extend an existing chain by appending this agent's entry.
   */
  extendChain(chain: IdentityChainEntry[], ctx: AgentRequestContext): IdentityChainEntry[] {
    return [...chain, this.issueEntry(ctx)];
  }
}
