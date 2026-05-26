/**
 * @datacules/agent-identity-mcp
 *
 * Exposes agent-identity credential resolution as an MCP server.
 * Any MCP-capable client — Claude Desktop, Claude Code, Cursor,
 * Windsurf, or a custom agent — can call the following tools:
 *
 *   resolve_credential           — resolves a credential for an AgentRequestContext
 *   resolve_migration_credential — resolves source+target pair for MigrationContext
 *   list_credentials             — lists active credentials (safe metadata only)
 *   list_rules                   — lists routing rules (highest priority first)
 *   health                       — liveness + loaded credential/rule counts
 *
 * Supports two transports:
 *   stdio    — stdin/stdout, compatible with Claude Desktop / Claude Code / Cursor configs
 *   http+sse — HTTP Server-Sent Events for hosted deployments
 *
 * Quick start (stdio):
 *   import { createAgentIdentityMcpServer } from '@datacules/agent-identity-mcp';
 *   const { start } = createAgentIdentityMcpServer({ credentials, rules });
 *   await start();  // reads from stdin, writes to stdout
 *
 * Quick start (HTTP):
 *   const { start } = createAgentIdentityMcpServer({
 *     credentials, rules, transport: 'http', httpPort: 3002
 *   });
 *   await start();
 *
 * Claude Desktop config snippet (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "agent-identity": {
 *         "command": "npx",
 *         "args": ["@datacules/agent-identity-mcp"],
 *         "env": {
 *           "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded JSON>",
 *           "AGENT_IDENTITY_RULES": "<base64-encoded JSON>"
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuditLogger, Credential, CredentialStore, RoutingRule } from '@datacules/agent-identity';
import { MemoryCredentialStore } from '@datacules/agent-identity';
import { ALL_TOOLS, type ToolDeps } from './tools.js';
import { StdioServerTransport, startHttpMcpTransport } from './transports.js';
import type { AgentIdentityMcpServerOptions } from './types.js';

export * from './types.js';
export { ALL_TOOLS } from './tools.js';

// ─── Server factory ───────────────────────────────────────────────────────────

export interface AgentIdentityMcpServerInit {
  /**
   * Credential array (convenience). Wrapped in a MemoryCredentialStore
   * unless `store` is also provided, in which case `store` takes precedence.
   */
  credentials?: Credential[];
  /** Custom CredentialStore (e.g. VaultCredentialStore, AwsCredentialStore) */
  store?: CredentialStore;
  rules: RoutingRule[];
  logger?: AuditLogger;
}

export type AgentIdentityMcpServerConfig = AgentIdentityMcpServerInit & AgentIdentityMcpServerOptions;

export interface AgentIdentityMcpServerHandle {
  /** MCP Server instance (use to attach additional request handlers if needed) */
  server: Server;
  /** Start the server and connect the configured transport. Resolves when ready. */
  start: () => Promise<void>;
  /** Stop / clean up (closes HTTP server for http transport; no-op for stdio) */
  stop: () => Promise<void>;
}

/**
 * Create an agent-identity MCP server.
 *
 * @example
 * // stdio (Claude Desktop / Claude Code config)
 * const { start } = createAgentIdentityMcpServer({ credentials, rules });
 * await start();
 *
 * @example
 * // HTTP+SSE (hosted / networked)
 * const { start } = createAgentIdentityMcpServer({
 *   credentials, rules, transport: 'http', httpPort: 3002,
 * });
 * await start();
 */
export function createAgentIdentityMcpServer(
  config: AgentIdentityMcpServerConfig
): AgentIdentityMcpServerHandle {
  const {
    credentials,
    store: customStore,
    rules,
    logger,
    name = 'agent-identity',
    version = '0.1.0',
    transport = 'stdio',
    httpPort = 3002,
    httpHost = '127.0.0.1',
    httpAuthToken,
  } = config;

  if (!customStore && !credentials) {
    throw new Error('[agent-identity-mcp] Provide either credentials[] or a custom store.');
  }

  const store: CredentialStore =
    customStore ?? new MemoryCredentialStore(credentials!);

  const deps: ToolDeps = { store, rules, logger };

  // Build the MCP server
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  // Register tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {
        type: 'object' as const,
        // Convert Zod schema to JSON Schema via .shape introspection for
        // simple objects; complex schemas fall back to an open object.
        properties: extractJsonSchemaProperties(t.inputSchema),
        required: extractRequiredKeys(t.inputSchema),
      },
    })),
  }));

  // Register tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = ALL_TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${request.params.name}` }) }],
        isError: true,
      };
    }
    return tool.handler(request.params.arguments ?? {}, deps);
  });

  let stopFn: (() => void) | null = null;

  const start = async (): Promise<void> => {
    if (transport === 'stdio') {
      const stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
    } else {
      stopFn = await startHttpMcpTransport({
        server,
        port: httpPort,
        host: httpHost,
        authToken: httpAuthToken,
      });
    }
  };

  const stop = async (): Promise<void> => {
    stopFn?.();
    await server.close();
  };

  return { server, start, stop };
}

// ─── JSON Schema helpers (lightweight — no ajv dependency) ───────────────────

function extractJsonSchemaProperties(schema: any): Record<string, unknown> {
  try {
    const shape = schema?._def?.shape?.() ?? schema?.shape ?? {};
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(shape)) {
      props[key] = zodToJsonSchemaNode(val);
    }
    return props;
  } catch {
    return {};
  }
}

function extractRequiredKeys(schema: any): string[] {
  try {
    const shape = schema?._def?.shape?.() ?? schema?.shape ?? {};
    return Object.entries(shape)
      .filter(([, v]: [string, any]) => {
        const typeName = v?._def?.typeName;
        return typeName !== 'ZodOptional' && typeName !== 'ZodDefault';
      })
      .map(([k]) => k);
  } catch {
    return [];
  }
}

function zodToJsonSchemaNode(zodNode: any): Record<string, unknown> {
  const typeName = zodNode?._def?.typeName;
  switch (typeName) {
    case 'ZodString':  return { type: 'string' };
    case 'ZodNumber':  return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum':    return { type: 'string', enum: zodNode._def.values };
    case 'ZodOptional':
    case 'ZodDefault': return zodToJsonSchemaNode(zodNode._def.innerType);
    case 'ZodObject':  return { type: 'object', properties: extractJsonSchemaProperties(zodNode) };
    default:           return { type: 'string' };
  }
}
