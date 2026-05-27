/**
 * Agent Federation — cross-org identity chains
 *
 * When agent A from org 1 calls agent B from org 2, a signed IdentityChain
 * token carries the full principal history across trust boundaries.
 * Each hop appends and signs its own entry. Any hop can verify the full chain.
 */
import type { IdentityChainEntry, FederationConfig, AgentRequestContext } from './types';

// ─── Federation Verifier ─────────────────────────────────────────────────────

export class FederationVerifier {
  constructor(private readonly config: FederationConfig) {}

  /**
   * Verify all entries in a chain.
   * Returns true only if every entry's signature verifies against the registered
   * public key for that entry's trust domain.
   */
  async verify(chain: IdentityChainEntry[]): Promise<boolean> {
    for (const entry of chain) {
      const pubKeyB64 = this.config.trustedDomains[entry.org];
      if (!pubKeyB64) {
        console.warn(`[FederationVerifier] Unknown trust domain: ${entry.org}`);
        return false;
      }
      const valid = await this.verifyEntry(entry, pubKeyB64);
      if (!valid) return false;
    }
    return true;
  }

  private async verifyEntry(entry: IdentityChainEntry, pubKeyB64: string): Promise<boolean> {
    try {
      const { signature, ...payload } = entry;
      const data = JSON.stringify(payload);
      const sigBytes = Buffer.from(signature, 'base64url');
      const pubKeyBytes = Buffer.from(pubKeyB64, 'base64');

      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const key = await crypto.subtle.importKey(
          'raw', pubKeyBytes,
          { name: 'Ed25519' },
          false,
          ['verify']
        );
        return crypto.subtle.verify('Ed25519', key, sigBytes, new TextEncoder().encode(data));
      }
      // Node.js fallback using built-in crypto
      const { createVerify } = await import('crypto');
      const verify = createVerify('SHA256');
      verify.update(data);
      return verify.verify({ key: pubKeyBytes, format: 'der', type: 'spki' }, sigBytes);
    } catch {
      return false;
    }
  }
}

// ─── Federation Issuer ───────────────────────────────────────────────────────

export interface FederationIssuerConfig extends FederationConfig {
  /** Base64-encoded Ed25519 private key for signing chain entries */
  privateKeyB64: string;
  /** Agent ID of the local agent */
  agentId: string;
}

export class FederationIssuer {
  constructor(private readonly config: FederationIssuerConfig) {}

  /** Issue a new single-entry identity chain from the local agent */
  async issue(ctx: AgentRequestContext): Promise<IdentityChainEntry[]> {
    const entry = await this.buildEntry(ctx);
    return [entry];
  }

  /** Extend an existing chain with a new entry from the local agent */
  async extend(
    existingChain: IdentityChainEntry[],
    ctx: AgentRequestContext
  ): Promise<IdentityChainEntry[]> {
    const entry = await this.buildEntry(ctx);
    return [...existingChain, entry];
  }

  private async buildEntry(ctx: AgentRequestContext): Promise<IdentityChainEntry> {
    const payload = {
      org: this.config.trustDomain,
      userId: ctx.userId,
      agentId: this.config.agentId,
      issuedAt: new Date().toISOString(),
    };
    const signature = await this.sign(JSON.stringify(payload));
    return { ...payload, signature };
  }

  private async sign(data: string): Promise<string> {
    const privKeyBytes = Buffer.from(this.config.privateKeyB64, 'base64');

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const key = await crypto.subtle.importKey(
        'raw', privKeyBytes,
        { name: 'Ed25519' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(data));
      return Buffer.from(sig).toString('base64url');
    }
    const { createSign } = await import('crypto');
    const sign = createSign('SHA256');
    sign.update(data);
    return sign.sign({ key: privKeyBytes, format: 'der', type: 'pkcs8' }, 'base64url');
  }
}
