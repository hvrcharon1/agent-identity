/**
 * @datacules/agent-identity-mcp-client
 *
 * Consumes external MCP servers as CredentialStores — the outbound direction
 * of the agent-identity MCP integration.
 *
 * Exports:
 *   McpCredentialStore   — CredentialStore impl that fetches credentials from
 *                          any MCP server exposing a list_credentials tool
 *   McpToolCaller        — thin client for calling any agent-identity MCP tool
 *                          directly (resolve_credential, health, etc.)
 *
 * Both classes support two transports:
 *   http   — SSE to a running HTTP+SSE agent-identity-mcp server
 *   stdio  — spawns an MCP server process and communicates over stdio
 *
 * Example — plug McpCredentialStore into a CredentialRouter:
 *
 *   import { McpCredentialStore } from '@datacules/agent-identity-mcp-client';
 *   import { createRouterFromStore } from '@datacules/agent-identity';
 *
 *   const store = new McpCredentialStore({
 *     transport: 'http',
 *     serverUrl: 'http://vault-mcp.internal:3002',
 *     authToken: process.env.MCP_AUTH_TOKEN,
 *   });
 *
 *   const router = createRouterFromStore(store, rules, logger);
 *   const resolved = await router.resolveAsync(ctx);   // async path via store
 *
 *   // Clean up when done
 *   process.on('SIGTERM', () => store.disconnect());
 *
 * Example — call the MCP server directly (no local router):
 *
 *   import { McpToolCaller } from '@datacules/agent-identity-mcp-client';
 *
 *   const caller = new McpToolCaller({
 *     transport: 'http',
 *     serverUrl: 'http://localhost:3002',
 *   });
 *   const result = await caller.resolveCredential({ userId: 'u1', ... });
 *   await caller.disconnect();
 */

export { McpCredentialStore } from './store.js';
export type { McpCredentialStoreOptions, McpCredentialStoreHttpOptions, McpCredentialStoreStdioOptions } from './store.js';
export { McpToolCaller } from './caller.js';
export type { McpToolCallerOptions, ResolvedCredentialResult, ResolvedMigrationResult, HealthResult } from './caller.js';
