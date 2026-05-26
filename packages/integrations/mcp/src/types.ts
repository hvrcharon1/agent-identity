/**
 * MCP-specific type extensions for @datacules/agent-identity.
 *
 * McpRequestContext extends AgentRequestContext with the MCP session and
 * client identifiers so audit logs can trace a credential resolution back
 * to the exact MCP session that triggered it.
 */

import type { AgentRequestContext, MigrationContext } from '@datacules/agent-identity';

// ─── MCP Request Context ──────────────────────────────────────────────────────

/**
 * AgentRequestContext enriched with MCP session metadata.
 * Pass this to AgentIdentityMcpServer.resolve() for full audit trail.
 */
export interface McpRequestContext extends AgentRequestContext {
  /** MCP session ID from the active transport session */
  mcpSessionId: string;
  /** MCP client identifier (e.g. 'claude-desktop', 'cursor', 'windsurf') */
  mcpClientId?: string;
  /** MCP protocol version negotiated during handshake */
  mcpProtocolVersion?: string;
}

/**
 * MigrationContext enriched with MCP session metadata.
 */
export interface McpMigrationContext extends MigrationContext {
  mcpSessionId: string;
  mcpClientId?: string;
  mcpProtocolVersion?: string;
}

// ─── Tool I/O shapes (validated by Zod in tools.ts) ──────────────────────────

export interface ResolveCredentialInput {
  userId: string;
  resourceId: string;
  resourceKind: 'shared' | 'personal';
  provider: 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'local';
  model: string;
  action: string;
  traceId: string;
  sessionId?: string;
  requestedAt?: string;
  parentTraceId?: string;
  // MCP extensions
  mcpSessionId?: string;
  mcpClientId?: string;
}

export interface ResolveMigrationInput {
  userId: string;
  resourceId: string;
  resourceKind: 'shared' | 'personal';
  provider: 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'local';
  model: string;
  action: string;
  traceId: string;
  migrationId: string;
  phase: 'dry-run' | 'extract' | 'transform' | 'load' | 'verify' | 'rollback';
  sourceResourceId: string;
  targetResourceId: string;
  batchIndex?: number;
  totalBatches?: number;
  dryRun: boolean;
  requestedAt?: string;
  mcpSessionId?: string;
  mcpClientId?: string;
}

// ─── MCP Server Options ───────────────────────────────────────────────────────

export interface AgentIdentityMcpServerOptions {
  /**
   * Server name sent during MCP handshake.
   * Appears in the client's tool list as the server label.
   */
  name?: string;
  /** Semantic version string reported during handshake */
  version?: string;
  /**
   * Transport mode.
   * - 'stdio'    : reads from stdin / writes to stdout (default; use for
   *               Claude Desktop, Claude Code, Cursor, Windsurf configs)
   * - 'http'     : HTTP + SSE transport on the specified port
   */
  transport?: 'stdio' | 'http';
  /** Port for HTTP+SSE transport (default: 3002) */
  httpPort?: number;
  /** Host for HTTP+SSE transport (default: '127.0.0.1') */
  httpHost?: string;
  /**
   * Optional bearer token required in MCP HTTP requests.
   * Ignored for stdio transport.
   */
  httpAuthToken?: string;
}
