/**
 * Server-side credential store stub (Finding #1).
 *
 * In production:
 * - Replace with HashiCorp Vault, AWS Secrets Manager, or an encrypted Postgres table.
 * - CREDENTIAL_STORE_URL and CREDENTIAL_ENCRYPTION_KEY are set in .env.local
 * - This module only runs in server context (Next.js API routes / Server Actions).
 */
import type { Credential, RoutingRule } from '../types';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '../credentials';

/**
 * Returns credentials from the server-side encrypted store.
 * In local dev, falls back to DEFAULT_CREDENTIALS.
 */
export async function getServerCredentials(): Promise<Credential[]> {
  // TODO: Connect to CREDENTIAL_STORE_URL and decrypt with CREDENTIAL_ENCRYPTION_KEY
  // Example (Vault):
  //   const vault = new VaultClient({ endpoint: process.env.CREDENTIAL_STORE_URL });
  //   return vault.read('secret/agent-identity/credentials');
  return DEFAULT_CREDENTIALS;
}

/**
 * Returns routing rules from the server-side store.
 * In local dev, falls back to DEFAULT_ROUTING_RULES.
 */
export async function getServerRules(): Promise<RoutingRule[]> {
  // TODO: Load rules from DB or config store
  return DEFAULT_ROUTING_RULES;
}
