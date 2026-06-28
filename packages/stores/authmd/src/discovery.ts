/**
 * discovery.ts — auth.md service discovery
 *
 * Implements RFC 9728 Protected Resource Metadata discovery + AS metadata
 * resolution to locate the agent_auth block for a given resource server.
 *
 * Discovery is intentionally side-effect-free and stateless — no caching.
 * The AgentAuthMdStore owns the token cache; discovery is re-run on each
 * cache miss so the agent_auth block stays fresh.
 */
import type { ProtectedResourceMetadata, AuthServerMetadata, AgentAuthBlock } from './types';

/** Discovery result containing both the agent_auth block and the full AS metadata. */
export interface DiscoveryResult {
  agentAuth: AgentAuthBlock;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
}

/**
 * Discover the agent_auth block for a resource server.
 *
 * Steps:
 *   1. GET {resourceServerUrl}/.well-known/oauth-protected-resource
 *      to fetch ProtectedResourceMetadata (RFC 9728).
 *   2. For each AS in prm.authorization_servers:
 *      GET {asBaseUrl}/.well-known/oauth-authorization-server
 *      and check for an agent_auth block.
 *   3. Return the first agent_auth block found with AS metadata, or null.
 *
 * Returns null (never throws) on any fetch or parse failure.
 */
export async function discoverService(
  resourceServerUrl: string,
  fetchFn: typeof globalThis.fetch
): Promise<DiscoveryResult | null> {
  try {
    const prmUrl = buildUrl(resourceServerUrl, '/.well-known/oauth-protected-resource');
    const prmResp = await fetchFn(prmUrl);
    if (!prmResp.ok) return null;

    const prm = await prmResp.json() as ProtectedResourceMetadata;
    if (!prm.authorization_servers?.length) return null;

    for (const asBaseUrl of prm.authorization_servers) {
      const asMeta = await fetchASMetadata(asBaseUrl, fetchFn);
      if (asMeta?.agent_auth) {
        return {
          agentAuth: asMeta.agent_auth,
          tokenEndpoint: asMeta.token_endpoint,
          revocationEndpoint: asMeta.revocation_endpoint,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch Authorization Server Metadata from the standard well-known endpoint.
 * Returns null on any non-2xx response or parse failure.
 */
export async function fetchASMetadata(
  asBaseUrl: string,
  fetchFn: typeof globalThis.fetch
): Promise<AuthServerMetadata | null> {
  try {
    const metaUrl = buildUrl(asBaseUrl, '/.well-known/oauth-authorization-server');
    const resp = await fetchFn(metaUrl);
    if (!resp.ok) return null;
    return await resp.json() as AuthServerMetadata;
  } catch {
    return null;
  }
}

/** Build a well-known URL, tolerating trailing slashes on the base URL. */
function buildUrl(base: string, path: string): string {
  // Use URL constructor to normalise base (strip trailing slash, add path)
  try {
    return new URL(path, base.endsWith('/') ? base.slice(0, -1) : base).toString();
  } catch {
    return `${base.replace(/\/$/, '')}${path}`;
  }
}
