/**
 * Example: LangChain Agent with agent-identity credential routing
 *
 * Demonstrates three integration patterns:
 *
 *   1. AgentIdentityTool   — expose credential resolution as an agent tool
 *   2. createAgentIdentityModel — resolve + inject credential, get back a ChatModel
 *   3. createAgentIdentityNode  — LangGraph node that resolves credential into state
 *
 * Run:
 *   node index.js
 *
 * Note: This example shows the API surface without making real LLM calls.
 * To make real calls, set OPENAI_API_KEY in your environment and uncomment
 * the model.invoke() call at the bottom.
 */

import { createRouter } from '@datacules/agent-identity';
import {
  AgentIdentityTool,
  createAgentIdentityModel,
  createAgentIdentityNode,
} from '@datacules/agent-identity-langchain';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// ─── Credentials + rules ──────────────────────────────────────────────────────
const credentials = [
  {
    id: 'cred-openai-prod',
    kind: 'fixed',
    name: 'OpenAI production key',
    status: 'active',
    provider: 'openai',
    scope: 'read write',
    ref: 'vault:openai/prod-slot',
  },
  {
    id: 'cred-anthropic-prod',
    kind: 'fixed',
    name: 'Anthropic production key',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/prod-slot',
  },
];

const rules = [
  {
    id: 'rule-openai',
    credentialRef: 'vault:openai/prod-slot',
    priority: 10,
    matchProvider: 'openai',
  },
  {
    id: 'rule-anthropic',
    credentialRef: 'vault:anthropic/prod-slot',
    priority: 10,
    matchProvider: 'anthropic',
  },
];

const logger = new ConsoleAuditLogger();
const router = createRouter(credentials, rules, logger);

// ─── Pattern 1: AgentIdentityTool ─────────────────────────────────────────────
// Expose credential resolution as a LangChain StructuredTool.
// Add it to createReactAgent({ tools: [tool] }) — agents can call it to
// resolve credentials on demand as part of their reasoning loop.
console.log('\n=== Pattern 1: AgentIdentityTool ===');

const tool = new AgentIdentityTool({ router });
console.log(`Tool name       : ${tool.name}`);
console.log(`Tool description: ${tool.description}`);

// Simulate a tool call as if an LLM agent invoked it
const toolResult = await tool.invoke({
  userId: 'user-engineer',
  resourceId: 'code-review-service',
  resourceKind: 'shared',
  provider: 'openai',
  model: 'gpt-4o',
  action: 'read',
  traceId: 'trace-tool-001',
  requestedAt: new Date().toISOString(),
});
console.log('Tool result:', JSON.parse(toolResult));

// ─── Pattern 2: createAgentIdentityModel ──────────────────────────────────────
// Resolve credential + get back a fully-configured ChatModel in one call.
// The model has the API key injected server-side — no credential in agent state.
console.log('\n=== Pattern 2: createAgentIdentityModel ===');

const ctx = {
  userId: 'user-engineer',
  resourceId: 'knowledge-base',
  resourceKind: 'shared',
  provider: 'openai',
  model: 'gpt-4o',
  action: 'read',
  traceId: 'trace-model-001',
  requestedAt: new Date().toISOString(),
};

try {
  const { model, resolved } = await createAgentIdentityModel(router, ctx);
  console.log(`Resolved credential : ${resolved.credentialId}`);
  console.log(`Model ready         : ${!!model}`);
  console.log('(In production: const response = await model.invoke([{ role: "user", content: "..." }]))');
} catch (err) {
  // Will throw if openai package is not installed — that\'s expected in this demo
  console.log(`Note: ${err.message}`);
  console.log('Install openai or @langchain/openai to run the full model call.');
}

// ─── Pattern 3: createAgentIdentityNode (LangGraph) ───────────────────────────
// Wrap a LangGraph node function to resolve the credential and inject it into
// graph state before the node runs.
console.log('\n=== Pattern 3: createAgentIdentityNode (LangGraph) ===');

// A simple node that would call the LLM — in a real graph this would use
// state.resolvedCredential to make the API call
const myLlmNode = async (state) => {
  console.log(`  Node running as user: ${state.ctx?.userId}`);
  console.log(`  Credential in state : ${state.resolvedCredential?.credentialId ?? 'none'}`);
  return { result: 'node ran' };
};

// Wrap it — the wrapped version resolves the credential before calling myLlmNode
const wrappedNode = createAgentIdentityNode(router, myLlmNode, {
  extractCtx: (state) => state.ctx,
});

// Run the wrapped node with a state that includes ctx
await wrappedNode({
  ctx: {
    userId: 'user-engineer',
    resourceId: 'analysis-service',
    resourceKind: 'shared',
    provider: 'openai',
    model: 'gpt-4o',
    action: 'read',
    traceId: 'trace-graph-001',
    requestedAt: new Date().toISOString(),
  },
});

console.log('\nAll three patterns resolve credentials without exposing raw API keys.\n');
