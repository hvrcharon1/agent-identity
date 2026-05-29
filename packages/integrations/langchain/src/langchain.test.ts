/**
 * langchain.test.ts
 *
 * Vitest unit tests for @datacules/agent-identity-langchain.
 *
 * Covers createAgentIdentityModel, AgentIdentityCallbackHandler,
 * and createAgentIdentityNode.
 *
 * @langchain/core/callbacks/base is mocked via vi.mock() factory.
 * vi.mock() calls are hoisted to the top of the module by vitest so
 * the mock is in place before the source file is imported. This means
 * the tests work whether or not @langchain/core is installed in the
 * root node_modules.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mock @langchain/core ─────────────────────────────────────────────────────
// Must be declared before the import of ./index because vi.mock() is hoisted.
vi.mock('@langchain/core/callbacks/base', () => ({
  BaseCallbackHandler: class MockBaseCallbackHandler {
    name: string = '';
  },
}));

import {
  createAgentIdentityModel,
  AgentIdentityCallbackHandler,
  createAgentIdentityNode,
} from './index';
import type { AgentRequestContext, Credential, RoutingRule } from '@datacules/agent-identity';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const credentials: Credential[] = [
  {
    id:       'cred-openai',
    kind:     'fixed',
    name:     'OpenAI prod',
    scope:    'openai:all',
    status:   'active',
    provider: 'openai',
    ref:      'openai-prod-slot',
  },
];

const rules: RoutingRule[] = [
  {
    id:             'rule-openai',
    description:    'Route all OpenAI requests',
    credentialRef:  'openai-prod-slot',
    credentialKind: 'fixed',
    priority:       10,
    matchProvider:  'openai',
  },
];

// Empty rules — no credential will resolve for any context
const rulesNoMatch: RoutingRule[] = [];

function makeCtx(overrides: Partial<AgentRequestContext> = {}): AgentRequestContext {
  return {
    userId:       'user-alice',
    resourceId:   'res-001',
    resourceKind: 'personal',
    provider:     'openai',
    model:        'gpt-4o',
    action:       'read',
    traceId:      'trace-abc',
    requestedAt:  new Date().toISOString(),
    ...overrides,
  };
}

// ─── createAgentIdentityModel ─────────────────────────────────────────────────

describe('createAgentIdentityModel', () => {
  it('returns resolved credential metadata', () => {
    const fetchSecret = vi.fn(async () => 'sk-secret');
    const result = createAgentIdentityModel(makeCtx(), { credentials, rules, fetchSecret });
    expect(result.resolved).toBeDefined();
    expect(result.resolved.ref).toBe('openai-prod-slot');
  });

  it('resolved has correct credentialId and resolvedFor', () => {
    const fetchSecret = vi.fn(async () => 'sk-secret');
    const { resolved } = createAgentIdentityModel(makeCtx(), { credentials, rules, fetchSecret });
    expect(resolved.credentialId).toBe('cred-openai');
    // kind=fixed → resolvedFor is 'service'
    expect(resolved.resolvedFor).toBe('service');
  });

  it('returns a getModel function', () => {
    const fetchSecret = vi.fn(async () => 'sk-secret');
    const { getModel } = createAgentIdentityModel(makeCtx(), { credentials, rules, fetchSecret });
    expect(typeof getModel).toBe('function');
  });

  it('throws when no routing rule matches the context', () => {
    const fetchSecret = vi.fn(async () => 'sk-secret');
    expect(() =>
      createAgentIdentityModel(makeCtx(), { credentials, rules: rulesNoMatch, fetchSecret })
    ).toThrow('[agent-identity] No credential resolved');
  });

  it('getModel() calls fetchSecret with the resolved ref then throws for unsupported provider', async () => {
    const fetchSecret = vi.fn(async () => 'sk-secret');
    // Use 'local' provider — it matches a rule but has no provider adapter in getModel()
    const localCredential: Credential = { ...credentials[0], provider: 'local', ref: 'local-slot' };
    const localRule: RoutingRule = { ...rules[0], credentialRef: 'local-slot', matchProvider: 'local' };
    const { getModel } = createAgentIdentityModel(
      makeCtx({ provider: 'local' }),
      { credentials: [localCredential], rules: [localRule], fetchSecret }
    );
    // getModel() calls fetchSecret first, then throws because 'local' is unsupported
    await expect(getModel()).rejects.toThrow('not yet supported');
    expect(fetchSecret).toHaveBeenCalledWith('local-slot');
  });
});

// ─── AgentIdentityCallbackHandler ────────────────────────────────────────────

describe('AgentIdentityCallbackHandler', () => {
  const resolved = {
    credentialId: 'cred-openai',
    kind:         'fixed' as const,
    ref:          'openai-prod-slot',
    resolvedFor:  'service',
  };

  it('instantiates without errors', () => {
    expect(() => new AgentIdentityCallbackHandler(resolved)).not.toThrow();
  });

  it('handleLLMStart attaches agentIdentity metadata to extraParams', async () => {
    const handler     = new AgentIdentityCallbackHandler(resolved);
    const extraParams: Record<string, unknown> = {};
    // Pass extraParams as the 5th argument; _llm and _prompts are unused
    await handler.handleLLMStart({} as never, [], 'run-001', undefined, extraParams);
    expect(extraParams['agentIdentityCredentialId']).toBe('cred-openai');
    expect(extraParams['agentIdentityResolvedFor']).toBe('service');
  });

  it('handleLLMEnd resolves without throwing', async () => {
    const handler = new AgentIdentityCallbackHandler(resolved);
    await expect(handler.handleLLMEnd({} as never, 'run-001')).resolves.toBeUndefined();
  });
});

// ─── createAgentIdentityNode ──────────────────────────────────────────────────

describe('createAgentIdentityNode', () => {
  it('injects resolvedCredential into state', async () => {
    const node   = createAgentIdentityNode(credentials, rules);
    const state  = { agentContext: makeCtx() };
    const result = await node(state);
    expect(result.resolvedCredential).toBeDefined();
    expect((result.resolvedCredential as { ref: string }).ref).toBe('openai-prod-slot');
  });

  it('preserves all existing state properties alongside resolvedCredential', async () => {
    const node   = createAgentIdentityNode(credentials, rules);
    const state  = { agentContext: makeCtx(), sessionId: 'sess-xyz', count: 42 };
    const result = await node(state);
    expect(result.sessionId).toBe('sess-xyz');
    expect(result.count).toBe(42);
    expect(result.agentContext).toStrictEqual(state.agentContext);
  });

  it('throws when state.agentContext is missing', async () => {
    const node = createAgentIdentityNode(credentials, rules);
    await expect(node({ otherField: true })).rejects.toThrow('state.agentContext is required');
  });

  it('throws when no credential resolves for the context', async () => {
    const node  = createAgentIdentityNode(credentials, rulesNoMatch);
    const state = { agentContext: makeCtx() };
    await expect(node(state)).rejects.toThrow('No credential resolved');
  });
});
