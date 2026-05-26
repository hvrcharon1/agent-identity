/**
 * McpCredentialStore — CredentialStore implementation that fetches
 * credentials from an external MCP server.
 *
 * Implements the full CredentialStore interface from @datacules/agent-identity
 * so it can be dropped into any CredentialRouter without any other changes:
 *
 *   import { McpCredentialStore } from '@datacules/agent-identity-mcp-client';
 *   import { createRouterFromStore } from '@datacules/agent-identity';
 *
 *   const store = new McpCredentialStore({
 *     serverUrl: 'http://localhost:3002',
 *     authToken: process.env.MCP_AUTH_TOKEN,
 *   });
 *   const router = createRouterFromStore(store, rules, logger);
 *
 * The MCP server this client connects to MUST expose a `list_credentials`
 * tool (i.e. another @datacules/agent-identity-mcp instance, a Vault MCP
 * server, a 1Password MCP server, or any custom server following the same
 * tool contract).
 *
 * Transport:
 *   - For a remote HTTP+SSE server: provide serverUrl
 *   - For an in-process stdio server (test / monorepo): provide serverProcess
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Credential, CredentialStore } from '@datacules/agent-identity';

// ─── Options ───────────────────────────────────────────────────────────────────

export interface McpCredentialStoreHttpOptions {
  transport: 'http';
  /**
   * Base URL of the remote agent-identity MCP server.
   * The SSE endpoint is expected at GET <serverUrl>/sse
   * and messages at POST <serverUrl>/messages.
   */
  serverUrl: string;
  /** Bearer token if the remote server requires auth */
  authToken?: string;
  /** Client name sent during MCP handshake (default: 'agent-identity-mcp-client') */
  clientName?: string;
  /** Client version (default: '0.1.0') */
  clientVersion?: string;
  /** TTL of the in-memory credential cache in ms (default: 60_000) */
  cacheTtlMs?: number;
}

export interface McpCredentialStoreStdioOptions {
  transport: 'stdio';
  /** Command to spawn the MCP server process */
  command: string;
  /** Arguments passed to the spawned process */
  args?: string[];
  /** Environment variables for the spawned process */
  env?: Record<string, string>;
  clientName?: string;
  clientVersion?: string;
  cacheTtlMs?: number;
}

export type McpCredentialStoreOptions =
  | McpCredentialStoreHttpOptions
  | McpCredentialStoreStdioOptions;

// ─── Cache entry ────────────────────────────────────────────────────────────

interface CacheEntry {
  credentials: Credential[];
  expiresAt: number;
}

// ─── McpCredentialStore ─────────────────────────────────────────────────────────

/**
 * CredentialStore implementation that pulls credentials from an external
 * MCP server by calling its `list_credentials` tool.
 *
 * Credentials are cached in-memory for `cacheTtlMs` (default 60s) to avoid
 * a round-trip on every router.resolve() call. Call invalidateCache() to
 * force a fresh fetch on the next operation.
 *
 * The MCP client connection is lazy — the first store operation connects
 * and caches the connection. Call disconnect() when the store is no longer
 * needed (e.g. on process shutdown).
 */
export class McpCredentialStore implements CredentialStore {
  private client: Client | null = null;
  private cache: CacheEntry | null = null;
  private readonly cacheTtlMs: number;
  private readonly options: McpCredentialStoreOptions;
  private connectPromise: Promise<void> | null = null;

  constructor(options: McpCredentialStoreOptions) {
    this.options = options;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  // ── Public CredentialStore interface ────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    const all = await this.listActive();
    return all.find((c) => c.ref === ref && c.status === 'active') ?? null;
  }

  async listActive(): Promise<Credential[]> {
    const cached = this.getFromCache();
    if (cached) return cached.filter((c) => c.status === 'active');
    const fresh = await this.fetchFromServer();
    return fresh.filter((c) => c.status === 'active');
  }

  async listByKind(kind: Credential['kind']): Promise<Credential[]> {
    const all = await this.listActive();
    return all.filter((c) => c.kind === kind);
  }

  // ── Cache management ──────────────────────────────────────────────────────

  /** Force the next store operation to fetch fresh credentials from the server */
  invalidateCache(): void {
    this.cache = null;
  }

  private getFromCache(): Credential[] | null {
    if (!this.cache) return null;
    if (Date.now() > this.cache.expiresAt) { this.cache = null; return null; }
    return this.cache.credentials;
  }

  private setCache(credentials: Credential[]): void {
    this.cache = { credentials, expiresAt: Date.now() + this.cacheTtlMs };
  }

  // ── MCP client lifecycle ─────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    // Serialize concurrent callers so we only connect once
    if (!this.connectPromise) this.connectPromise = this._connect();
    await this.connectPromise;
    this.connectPromise = null;
  }

  private async _connect(): Promise<void> {
    const opts = this.options;
    const clientName = opts.clientName ?? 'agent-identity-mcp-client';
    const clientVersion = opts.clientVersion ?? '0.1.0';

    this.client = new Client(
      { name: clientName, version: clientVersion },
      { capabilities: {} }
    );

    if (opts.transport === 'http') {
      const sseUrl = new URL('/sse', opts.serverUrl);
      const headers: Record<string, string> = {};
      if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;

      const transport = new SSEClientTransport(sseUrl, { headers });
      await this.client.connect(transport);
    } else {
      const transport = new StdioClientTransport({
        command: opts.command,
        args: opts.args ?? [],
        env: opts.env,
      });
      await this.client.connect(transport);
    }
  }

  /** Disconnect the MCP client and clear the cache. Call on process shutdown. */
  async disconnect(): Promise<void> {
    this.invalidateCache();
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ── Remote fetch ───────────────────────────────────────────────────────────

  private async fetchFromServer(): Promise<Credential[]> {
    await this.ensureConnected();

    const result = await this.client!.callTool({
      name: 'list_credentials',
      arguments: {},
    });

    const text = (result.content as Array<{ type: string; text: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    let parsed: { credentials?: Credential[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `[McpCredentialStore] MCP server returned non-JSON response from list_credentials: ${text.slice(0, 200)}`
      );
    }

    if (!Array.isArray(parsed.credentials)) {
      throw new Error(
        '[McpCredentialStore] MCP server list_credentials response missing credentials array'
      );
    }

    this.setCache(parsed.credentials);
    return parsed.credentials;
  }
}
