/**
 * McpToolCaller — utility for calling arbitrary tools on a connected
 * agent-identity MCP server from application code.
 *
 * While McpCredentialStore handles the CredentialStore contract,
 * McpToolCaller lets you call any tool (resolve_credential,
 * resolve_migration_credential, health, etc.) directly — useful
 * when you want the MCP server to perform the resolution and return
 * the result without going through a local CredentialRouter.
 *
 * Example:
 *   const caller = new McpToolCaller({ transport: 'http', serverUrl: 'http://localhost:3002' });
 *   const result = await caller.resolveCredential({ userId: 'u1', ... });
 *   await caller.disconnect();
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpCredentialStoreOptions } from './store.js';

export type McpToolCallerOptions = McpCredentialStoreOptions;

export interface ResolvedCredentialResult {
  ok: boolean;
  credentialId: string;
  kind: 'fixed' | 'user-delegated';
  resolvedFor: string;
}

export interface ResolvedMigrationResult {
  ok: boolean;
  migrationId: string;
  source: ResolvedCredentialResult;
  target: ResolvedCredentialResult;
  expiresAt: string | null;
}

export interface HealthResult {
  status: 'ok' | 'error';
  credentialsLoaded: number;
  rulesLoaded: number;
  timestamp: string;
}

/**
 * Thin wrapper around the MCP SDK Client for calling agent-identity
 * MCP tools directly. Connection is lazy and cached after first call.
 */
export class McpToolCaller {
  private client: Client | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly options: McpToolCallerOptions;

  constructor(options: McpToolCallerOptions) {
    this.options = options;
  }

  // ── High-level helpers ─────────────────────────────────────────────────────

  /** Resolve a credential via the remote MCP server */
  async resolveCredential(
    ctx: Record<string, unknown>
  ): Promise<ResolvedCredentialResult> {
    return this.callTool<ResolvedCredentialResult>('resolve_credential', ctx);
  }

  /** Resolve a migration credential pair via the remote MCP server */
  async resolveMigrationCredential(
    ctx: Record<string, unknown>
  ): Promise<ResolvedMigrationResult> {
    return this.callTool<ResolvedMigrationResult>('resolve_migration_credential', ctx);
  }

  /** Check the health of the remote agent-identity MCP server */
  async health(): Promise<HealthResult> {
    return this.callTool<HealthResult>('health', {});
  }

  // ── Generic tool call ────────────────────────────────────────────────────────

  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    await this.ensureConnected();

    const result = await this.client!.callTool({ name: toolName, arguments: args });

    const text = (result.content as Array<{ type: string; text: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(
        `[McpToolCaller] Tool "${toolName}" returned non-JSON: ${text.slice(0, 200)}`
      );
    }

    if ((parsed as any)?.error) {
      throw new Error(`[McpToolCaller] Tool "${toolName}" error: ${(parsed as any).error}`);
    }

    return parsed;
  }

  /** Disconnect from the remote MCP server */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (!this.connectPromise) this.connectPromise = this._connect();
    await this.connectPromise;
    this.connectPromise = null;
  }

  private async _connect(): Promise<void> {
    const opts = this.options;
    this.client = new Client(
      { name: opts.clientName ?? 'agent-identity-mcp-caller', version: opts.clientVersion ?? '0.1.0' },
      { capabilities: {} }
    );

    if (opts.transport === 'http') {
      const sseUrl = new URL('/sse', opts.serverUrl);
      const headers: Record<string, string> = {};
      if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;
      await this.client.connect(new SSEClientTransport(sseUrl, { requestInit: { headers } }));
    } else {
      await this.client.connect(
        new StdioClientTransport({
          command: opts.command,
          args: opts.args ?? [],
          env: opts.env,
        })
      );
    }
  }
}
