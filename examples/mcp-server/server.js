/**
 * Example: agent-identity MCP Server
 *
 * Exposes credential resolution as Model Context Protocol (MCP) tools.
 * Any MCP-capable client — Claude Desktop, Claude Code, Cursor, Windsurf,
 * or a custom agent — can call these tools directly over stdio or HTTP+SSE.
 *
 * Tools exposed:
 *   resolve_credential          — resolve a credential for an AgentRequestContext
 *   resolve_migration_credential — resolve source + target pair for migration
 *   list_credentials            — list active credentials (safe metadata only)
 *   list_rules                  — list routing rules by priority
 *   health                      — liveness check
 *
 * Run (stdio transport — for Claude Desktop / Claude Code):
 *   node server.js
 *
 * Run (HTTP+SSE transport — for networked deployments):
 *   node server.js --transport http
 *   # Server starts on http://localhost:3002
 */

import { createAgentIdentityMcpServer } from '@datacules/agent-identity-mcp';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// ─── Credentials + rules ──────────────────────────────────────────────────────
const credentials = [
  {
    id: 'cred-openai-shared',
    kind: 'fixed',
    name: 'OpenAI shared service account',
    status: 'active',
    provider: 'openai',
    scope: 'read write',
    ref: 'vault:openai/shared-slot',
  },
  {
    id: 'cred-anthropic-shared',
    kind: 'fixed',
    name: 'Anthropic shared service account',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/shared-slot',
  },
];

const rules = [
  {
    id: 'rule-openai',
    credentialRef: 'vault:openai/shared-slot',
    priority: 10,
    matchProvider: 'openai',
  },
  {
    id: 'rule-anthropic',
    credentialRef: 'vault:anthropic/shared-slot',
    priority: 10,
    matchProvider: 'anthropic',
  },
];

// ─── Transport ────────────────────────────────────────────────────────────────
const useHttp = process.argv.includes('--transport') &&
  process.argv[process.argv.indexOf('--transport') + 1] === 'http';

const logger = new ConsoleAuditLogger();

const { start } = createAgentIdentityMcpServer({
  credentials,
  rules,
  logger,
  transport: useHttp ? 'http' : 'stdio',
  httpPort: 3002,
});

await start();

if (useHttp) {
  console.error('agent-identity MCP server running on http://localhost:3002');
  console.error('SSE endpoint: http://localhost:3002/sse');
} else {
  // stdio: server is now waiting for MCP messages on stdin
}
