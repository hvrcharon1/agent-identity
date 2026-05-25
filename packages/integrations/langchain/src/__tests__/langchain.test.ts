/**
 * @datacules/agent-identity-langchain — tests
 *
 * Validates the three exported integration shapes without a real LangChain
 * dependency (we test the logic, not LangChain internals).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';
import { AgentIdentityTool } from '../src/AgentIdentityTool';
import { withAgentIdentity } from '../src/withAgentIdentity';
import { wrapWithAgentIdentity } from '../src/langGraphNode';

// ─── Shared fixtures ────────────────────────────────────────────────────────────

const MOCK_CTX: AgentRequestContext = {
  userId: 'user-test',
  resourceId: 'kb',
  resourceKind: 'shared',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: 't-001',
  requestedAt: '2026-01-01T00:00:00Z',
};

const MOCK_RESOLVED: ResolvedCredential = {
  credentialId: 'cred-1',
  kind: 'fixed',
  ref: 'svc-key',
  resolvedFor: 'service',
};

function makeRouter(resolved: ResolvedCredential | null = MOCK_RESOLVED) {
  return {
    resolveAsync: vi.fn().mockResolvedValue(resolved),
    resolve: vi.fn().mockReturnValue(resolved),
  } as unknown as import('@datacules/agent-identity').CredentialRouter;
}

// ─── AgentIdentityTool ─────────────────────────────────────────────────────────

describe('AgentIdentityTool', () => {
  it('returns resolvedFor when router resolves', async () => {
    const tool = new AgentIdentityTool({ router: makeRouter() });
    const result = await tool.invoke({ ...MOCK_CTX, requestedAt: '2026-01-01T00:00:00Z' });
    const parsed = JSON.parse(result);
    expect(parsed.resolvedFor).toBe('service');
  });

  it('throws when router returns null', async () => {
    const tool = new AgentIdentityTool({ router: makeRouter(null) });
    await expect(tool.invoke({ ...MOCK_CTX, requestedAt: '2026-01-01T00:00:00Z' })).rejects.toThrow(
      'No credential resolved'
    );
  });

  it('calls HTTP endpoint when no router provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ resolvedFor: 'service', expiresAt: null }), { status: 200 })
    );
    const tool = new AgentIdentityTool({
      resolveEndpoint: 'http://localhost:3001/api/resolve',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const result = await tool.invoke({ ...MOCK_CTX, requestedAt: '2026-01-01T00:00:00Z' });
    expect(JSON.parse(result).resolvedFor).toBe('service');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('has correct name and description', () => {
    const tool = new AgentIdentityTool({ router: makeRouter() });
    expect(tool.name).toBe('agent_identity_resolve');
    expect(tool.description).toContain('credential');
  });
});

// ─── withAgentIdentity ─────────────────────────────────────────────────────────

describe('withAgentIdentity', () => {
  it('injects _resolvedCredential into input', async () => {
    const fn = withAgentIdentity(makeRouter(), { extractCtx: (i) => i.ctx as AgentRequestContext });
    const result = await fn({ ctx: MOCK_CTX, extra: 'data' } as Record<string, unknown>);
    expect(result._resolvedCredential).toEqual(MOCK_RESOLVED);
    expect((result as Record<string, unknown>).extra).toBe('data');
  });

  it('uses custom injectKey', async () => {
    const fn = withAgentIdentity(makeRouter(), {
      extractCtx: (i) => i as unknown as AgentRequestContext,
      injectKey: 'myCredential',
    });
    const result = await fn(MOCK_CTX as unknown as Record<string, unknown>);
    expect((result as Record<string, unknown>).myCredential).toEqual(MOCK_RESOLVED);
  });

  it('throws when no credential is resolved', async () => {
    const fn = withAgentIdentity(makeRouter(null), {
      extractCtx: (i) => i as unknown as AgentRequestContext,
    });
    await expect(fn(MOCK_CTX as unknown as Record<string, unknown>)).rejects.toThrow(
      'No credential resolved'
    );
  });
});

// ─── wrapWithAgentIdentity ─────────────────────────────────────────────────────

describe('wrapWithAgentIdentity', () => {
  interface TestState {
    agentCtx: AgentRequestContext;
    messages: string[];
    _resolvedCredential?: ResolvedCredential;
  }

  const baseState: TestState = { agentCtx: MOCK_CTX, messages: [] };

  it('resolves credential and includes it in state patch', async () => {
    const nodeFn = vi.fn().mockResolvedValue({ messages: ['done'] });
    const wrapped = wrapWithAgentIdentity(makeRouter(), nodeFn, {
      extractCtx: (s) => s.agentCtx,
    });
    const patch = await wrapped(baseState);
    expect(patch._resolvedCredential).toEqual(MOCK_RESOLVED);
    expect(patch.messages).toEqual(['done']);
  });

  it('calls the original node with credential already in state', async () => {
    const nodeFn = vi.fn().mockImplementation(async (state: TestState) => {
      expect(state._resolvedCredential).toEqual(MOCK_RESOLVED);
      return {};
    });
    const wrapped = wrapWithAgentIdentity(makeRouter(), nodeFn, {
      extractCtx: (s) => s.agentCtx,
    });
    await wrapped(baseState);
    expect(nodeFn).toHaveBeenCalledOnce();
  });

  it('throws when credential cannot be resolved', async () => {
    const nodeFn = vi.fn();
    const wrapped = wrapWithAgentIdentity(makeRouter(null), nodeFn, {
      extractCtx: (s) => s.agentCtx,
    });
    await expect(wrapped(baseState)).rejects.toThrow('No credential resolved for node');
    expect(nodeFn).not.toHaveBeenCalled();
  });

  it('uses custom credentialKey', async () => {
    const nodeFn = vi.fn().mockResolvedValue({});
    const wrapped = wrapWithAgentIdentity(makeRouter(), nodeFn, {
      extractCtx: (s) => s.agentCtx,
      credentialKey: 'myCred',
    });
    const patch = await wrapped(baseState);
    expect((patch as Record<string, unknown>).myCred).toEqual(MOCK_RESOLVED);
  });
});
