/**
 * @datacules/agent-identity-langchain
 *
 * LangChain and LangGraph adapters for @datacules/agent-identity.
 *
 * Exports:
 *   AgentIdentityTool       — StructuredTool for use in LangChain agents
 *   withAgentIdentity       — LCEL wrapper function (pass to RunnableLambda.from())
 *   wrapWithAgentIdentity   — LangGraph node wrapper
 */
export { AgentIdentityTool } from './AgentIdentityTool';
export type { AgentIdentityToolOptions, AgentIdentityToolInput } from './AgentIdentityTool';

export { withAgentIdentity } from './withAgentIdentity';
export type { WithAgentIdentityOptions, WithAgentIdentityOutput } from './withAgentIdentity';

export { wrapWithAgentIdentity } from './langGraphNode';
export type {
  WrapWithAgentIdentityOptions,
  LangGraphNodeFn,
} from './langGraphNode';
