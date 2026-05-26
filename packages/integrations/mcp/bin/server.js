#!/usr/bin/env node
/**
 * Standalone CLI entry point for @datacules/agent-identity-mcp.
 *
 * Credentials and rules are loaded from environment variables:
 *
 *   AGENT_IDENTITY_CREDENTIALS  Base64-encoded JSON array of Credential objects
 *   AGENT_IDENTITY_RULES        Base64-encoded JSON array of RoutingRule objects
 *   MCP_TRANSPORT               'stdio' (default) | 'http'
 *   MCP_HTTP_PORT               HTTP port when MCP_TRANSPORT=http (default: 3002)
 *   MCP_HTTP_HOST               HTTP host (default: 127.0.0.1)
 *   MCP_HTTP_AUTH_TOKEN         Optional bearer token for HTTP transport
 *
 * Example Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "agent-identity": {
 *         "command": "npx",
 *         "args": ["@datacules/agent-identity-mcp"],
 *         "env": {
 *           "AGENT_IDENTITY_CREDENTIALS": "<base64-json>",
 *           "AGENT_IDENTITY_RULES": "<base64-json>"
 *         }
 *       }
 *     }
 *   }
 */

import { createAgentIdentityMcpServer } from '../dist/esm/index.js';

function loadBase64Json(envVar, name) {
  const raw = process.env[envVar];
  if (!raw) {
    console.error(`[agent-identity-mcp] ${name}: ${envVar} is not set. Provide base64-encoded JSON.`);
    process.exit(1);
  }
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (e) {
    console.error(`[agent-identity-mcp] ${name}: Failed to parse ${envVar} — ${e.message}`);
    process.exit(1);
  }
}

const credentials = loadBase64Json('AGENT_IDENTITY_CREDENTIALS', 'credentials');
const rules       = loadBase64Json('AGENT_IDENTITY_RULES', 'rules');

const transport    = process.env.MCP_TRANSPORT ?? 'stdio';
const httpPort     = parseInt(process.env.MCP_HTTP_PORT ?? '3002', 10);
const httpHost     = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
const httpAuthToken = process.env.MCP_HTTP_AUTH_TOKEN;

const { start } = createAgentIdentityMcpServer({
  credentials,
  rules,
  transport,
  httpPort,
  httpHost,
  httpAuthToken,
});

process.on('uncaughtException', (err) => {
  console.error('[agent-identity-mcp] uncaughtException:', err);
  process.exit(1);
});

await start();
