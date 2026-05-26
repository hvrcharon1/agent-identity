/**
 * Transport helpers for @datacules/agent-identity-mcp.
 *
 * Provides two transports:
 *   - StdioServerTransport  : stdin/stdout, for Claude Desktop / Claude Code / Cursor config
 *   - createHttpMcpTransport: HTTP + SSE, for hosted / networked deployments
 *
 * The HTTP transport adds optional bearer-token auth. The SSE endpoint at
 * GET /sse initialises a session; the message endpoint at POST /messages
 * receives client tool calls and posts responses back over the SSE stream.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export { StdioServerTransport };

// ─── HTTP + SSE Transport ─────────────────────────────────────────────────────

export interface HttpMcpTransportOptions {
  /** MCP Server instance to connect the transport to */
  server: Server;
  /** TCP port to listen on (default: 3002) */
  port?: number;
  /** Bind address (default: '127.0.0.1') */
  host?: string;
  /**
   * Optional static bearer token.
   * Requests without a matching Authorization: Bearer <token> header are
   * rejected with 401. Omit to allow unauthenticated connections (only
   * appropriate on a private network / localhost).
   */
  authToken?: string;
}

/**
 * Start an HTTP + SSE MCP transport.
 *
 * Session lifecycle:
 *   1. Client opens GET /sse — transport creates an SSEServerTransport,
 *      connects it to the MCP Server, and starts streaming.
 *   2. Client POSTs tool calls to POST /messages?sessionId=<id>.
 *   3. Transport routes each message to the correct session and replies
 *      via the open SSE stream.
 *
 * Returns a cleanup function that closes the HTTP server.
 */
export async function startHttpMcpTransport(options: HttpMcpTransportOptions): Promise<() => void> {
  const { server, port = 3002, host = '127.0.0.1', authToken } = options;

  // Session registry: sessionId → active SSEServerTransport
  const sessions = new Map<string, SSEServerTransport>();

  const http = await import('node:http');

  function authenticate(req: IncomingMessage, res: ServerResponse): boolean {
    if (!authToken) return true;
    const header = req.headers['authorization'] ?? '';
    if (header === `Bearer ${authToken}`) return true;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — valid Bearer token required' }));
    return false;
  }

  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);

    // CORS for browser-based MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (!authenticate(req, res)) return;

    // ── SSE session init ──────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      sessions.set(transport.sessionId, transport);

      req.on('close', () => sessions.delete(transport.sessionId));

      await server.connect(transport);
      return;
    }

    // ── Incoming tool call message ────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = sessions.get(sessionId);

      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Session ${sessionId} not found or expired` }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    // ── Health probe (GET /) ──────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size, transport: 'http+sse' }));
      return;
    }

    res.writeHead(404); res.end();
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`[agent-identity-mcp] HTTP+SSE transport listening on http://${host}:${port}`);

  return () => httpServer.close();
}
