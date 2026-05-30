import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MCP SDK modules — the lazy-connect pattern means these are only imported
// at the module level but never called at runtime if we inject mock clients directly.
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(() => ({ callTool: vi.fn(), close: vi.fn(), connect: vi.fn() })),
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));

import { McpCredentialStore } from './store.js';
import { McpToolCaller } from './caller.js';
import type { Credential } from '@datacules/agent-identity';

const makeCred = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'cred-openai',
  kind: 'fixed',
  name: 'OpenAI Key',
  scope: 'global',
  status: 'active',
  provider: 'openai',
  ref: 'openai-prod-slot',
  ...overrides,
});

/** Build the content array shape that McpCredentialStore / McpToolCaller expect from callTool() */
const makeToolResult = (data: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

// ─── McpCredentialStore ──────────────────────────────────────────────────────

describe('McpCredentialStore', () => {
  let store: McpCredentialStore;
  let mockCallTool: ReturnType<typeof vi.fn>;
  let mockClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallTool = vi.fn();
    mockClose = vi.fn();
    store = new McpCredentialStore({ transport: 'http', serverUrl: 'http://localhost:3002' });
    // Inject a mock client — ensureConnected() checks `this.client` first, so _connect() is never called.
    (store as any).client = { callTool: mockCallTool, close: mockClose };
  });

  describe('listActive()', () => {
    it('returns only active credentials from the MCP server list_credentials response', async () => {
      const active = makeCred({ id: 'cred-active', ref: 'active-slot' });
      const pending = makeCred({ id: 'cred-pending', ref: 'pending-slot', status: 'pending' });
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [active, pending] }));
      const results = await store.listActive();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(active);
    });

    it('caches results — calls list_credentials tool only once for two listActive() calls', async () => {
      const cred = makeCred();
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [cred] }));
      await store.listActive();
      await store.listActive();
      // Second call hits cache; callTool should be called exactly once.
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache() forces a fresh fetch on the next listActive() call', async () => {
      const cred = makeCred();
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [cred] }));
      await store.listActive();
      store.invalidateCache();
      await store.listActive();
      // Cache was cleared; callTool should have been called twice.
      expect(mockCallTool).toHaveBeenCalledTimes(2);
    });

    it('throws with a non-JSON message when the server returns unparseable text', async () => {
      mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'not-json-at-all' }] });
      await expect(store.listActive()).rejects.toThrow('non-JSON response');
    });

    it('throws with a missing-credentials-array message when the response has no credentials field', async () => {
      mockCallTool.mockResolvedValue(makeToolResult({ data: [] }));
      await expect(store.listActive()).rejects.toThrow('missing credentials array');
    });
  });

  describe('findByRef()', () => {
    it('returns the matching active credential by ref', async () => {
      const cred = makeCred({ ref: 'openai-prod-slot' });
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [cred] }));
      expect(await store.findByRef('openai-prod-slot')).toEqual(cred);
    });

    it('returns null when the ref is not present in the server credential list', async () => {
      const cred = makeCred({ ref: 'other-slot' });
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [cred] }));
      expect(await store.findByRef('missing-ref')).toBeNull();
    });
  });

  describe('listByKind()', () => {
    it('returns only credentials matching the requested kind', async () => {
      const fixed = makeCred({ kind: 'fixed', id: 'cred-f', ref: 'fixed-slot' });
      const delegated = makeCred({ kind: 'user-delegated', id: 'cred-u', ref: 'user-slot' });
      mockCallTool.mockResolvedValue(makeToolResult({ credentials: [fixed, delegated] }));
      const result = await store.listByKind('fixed');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('fixed');
    });
  });

  describe('disconnect()', () => {
    it('calls close() on the injected client and sets this.client to null', async () => {
      await store.disconnect();
      expect(mockClose).toHaveBeenCalled();
      expect((store as any).client).toBeNull();
    });
  });
});

// ─── McpToolCaller ────────────────────────────────────────────────────────────

describe('McpToolCaller', () => {
  let caller: McpToolCaller;
  let mockCallTool: ReturnType<typeof vi.fn>;
  let mockClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallTool = vi.fn();
    mockClose = vi.fn();
    caller = new McpToolCaller({ transport: 'http', serverUrl: 'http://localhost:3002' });
    // Inject a mock client — ensureConnected() short-circuits on this.client
    (caller as any).client = { callTool: mockCallTool, close: mockClose };
  });

  it('resolveCredential() calls the resolve_credential tool with forwarded args and returns parsed result', async () => {
    const expected = { ok: true, credentialId: 'cred-1', kind: 'fixed', resolvedFor: 'service' };
    mockCallTool.mockResolvedValue(makeToolResult(expected));
    const result = await caller.resolveCredential({ userId: 'u1', provider: 'openai' });
    expect(result).toEqual(expected);
    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'resolve_credential',
      arguments: { userId: 'u1', provider: 'openai' },
    });
  });

  it('resolveMigrationCredential() calls the resolve_migration_credential tool and returns pair', async () => {
    const expected = {
      ok: true,
      migrationId: 'mig-1',
      source: { credentialId: 'src' },
      target: { credentialId: 'tgt' },
      expiresAt: null,
    };
    mockCallTool.mockResolvedValue(makeToolResult(expected));
    const result = await caller.resolveMigrationCredential({ migrationId: 'mig-1' });
    expect(result.migrationId).toBe('mig-1');
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'resolve_migration_credential' })
    );
  });

  it('health() calls the health tool and returns the status object', async () => {
    const expected = {
      status: 'ok',
      credentialsLoaded: 5,
      rulesLoaded: 3,
      timestamp: new Date().toISOString(),
    };
    mockCallTool.mockResolvedValue(makeToolResult(expected));
    const result = await caller.health();
    expect(result.status).toBe('ok');
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'health', arguments: {} });
  });

  it('callTool() generic escape hatch returns the parsed result for any tool', async () => {
    mockCallTool.mockResolvedValue(makeToolResult({ foo: 'bar', count: 42 }));
    const result = await caller.callTool('my_custom_tool', { arg: 1 });
    expect(result).toEqual({ foo: 'bar', count: 42 });
  });

  it('throws with a non-JSON error when the tool returns unparseable text', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'NOT JSON!' }] });
    await expect(caller.callTool('my_tool', {})).rejects.toThrow('non-JSON');
  });

  it('throws with the tool error message when the parsed result contains an error field', async () => {
    mockCallTool.mockResolvedValue(makeToolResult({ error: 'credential not found' }));
    await expect(caller.callTool('resolve_credential', {})).rejects.toThrow('credential not found');
  });

  it('disconnect() calls close() on the injected client', async () => {
    await caller.disconnect();
    expect(mockClose).toHaveBeenCalled();
  });
});
