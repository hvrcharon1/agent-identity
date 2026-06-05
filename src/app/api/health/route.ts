/**
 * GET /api/health
 *
 * Liveness probe for the agent-identity server. Used by:
 *   - `agent-identity-cli health` (packages/cli/src/cli.ts — runHealth())
 *   - Docker HEALTHCHECK directives
 *   - Kubernetes liveness probes
 *   - Uptime monitors / load balancers
 *
 * Returns a JSON summary of server state — never exposes credential secrets
 * or raw configuration values.
 *
 * Response:
 *   200  { status: 'ok', version, timestamp, credentialsLoaded, rulesLoaded }
 */
import { NextResponse } from 'next/server';
import { getServerStore, getServerRules } from '@/lib/server/credentialStore';

export async function GET() {
  const [store, rules] = await Promise.all([getServerStore(), getServerRules()]);
  const credentials = await store.listActive();
  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version ?? 'unknown',
    timestamp: new Date().toISOString(),
    credentialsLoaded: credentials.length,
    rulesLoaded: rules.length,
  });
}
