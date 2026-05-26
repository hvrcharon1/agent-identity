/**
 * LangChain integration for @datacules/agent-identity.
 *
 * Provides:
 *   createAgentIdentityModel()      — wraps ChatOpenAI/ChatAnthropic with credential resolution
 *   AgentIdentityCallbackHandler    — LangChain callback handler for audit logging
 *   createAgentIdentityNode()       — LangGraph StateGraph node for credential resolution
 *
 * Usage (LangChain):
 *   const { getModel } = createAgentIdentityModel(ctx, credentials, rules, fetchSecret);
 *   const model = await getModel();
 *   const result = await model.invoke([{ role: 'user', content: 'Hello' }]);
 *
 * Usage (LangGraph):
 *   const graph = new StateGraph(...);
 *   graph.addNode('resolve-creds', createAgentIdentityNode(credentials, rules, logger));
 */

import { createRouter } from '@datacules/agent-identity';
import type {
  AgentRequestContext,
  AuditLogger,
  Credential,
  ResolvedCredential,
  RoutingRule,
} from '@datacules/agent-identity';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';

// ─── createAgentIdentityModel ──────────────────────────────────────────────────────

export interface AgentIdentityModelOptions {
  credentials: Credential[];
  rules: RoutingRule[];
  /**
   * Server-side secret fetcher. Receives the credential ref and returns
   * the raw API key. NEVER call this client-side — use in a server route only.
   */
  fetchSecret: (ref: string) => Promise<string>;
  logger?: AuditLogger;
}

export interface AgentIdentityModelResult {
  /** Resolved credential metadata (safe to log, never contains raw secret) */
  resolved: ResolvedCredential;
  /**
   * Returns the LangChain model instance with the API key injected.
   * Dynamic import keeps @langchain/openai and @langchain/anthropic as
   * optional peer deps — only the provider actually used is imported.
   */
  getModel: () => Promise<unknown>;
}

/**
 * Resolve a credential and return a factory that builds the correct
 * LangChain chat model with the API key injected server-side.
 *
 * The raw secret is fetched via fetchSecret(ref) and passed directly to the
 * model constructor. It never appears in a log, a response body, or the
 * browser — the model is built on the server and used there.
 */
export function createAgentIdentityModel(
  ctx: AgentRequestContext,
  options: AgentIdentityModelOptions
): AgentIdentityModelResult {
  const router = createRouter(options.credentials, options.rules, options.logger);
  const resolved = router.resolve(ctx);
  if (!resolved) throw new Error(`[agent-identity] No credential resolved for context: ${JSON.stringify(ctx)}`);

  const getModel = async (): Promise<unknown> => {
    const apiKey = await options.fetchSecret(resolved.ref);

    const meta = {
      agentIdentityCredentialId: resolved.credentialId,
      agentIdentityResolvedFor: resolved.resolvedFor,
      traceId: ctx.traceId,
    };

    if (ctx.provider === 'openai') {
      const { ChatOpenAI } = await import('@langchain/openai' as string);
      return new (ChatOpenAI as any)({ modelName: ctx.model, openAIApiKey: apiKey, metadata: meta });
    }
    if (ctx.provider === 'anthropic') {
      const { ChatAnthropic } = await import('@langchain/anthropic' as string);
      return new (ChatAnthropic as any)({ modelName: ctx.model, anthropicApiKey: apiKey, metadata: meta });
    }
    if (ctx.provider === 'gemini') {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai' as string);
      return new (ChatGoogleGenerativeAI as any)({ modelName: ctx.model, apiKey, metadata: meta });
    }
    if (ctx.provider === 'mistral') {
      const { ChatMistralAI } = await import('@langchain/mistralai' as string);
      return new (ChatMistralAI as any)({ modelName: ctx.model, apiKey, metadata: meta });
    }
    throw new Error(`[agent-identity/langchain] Provider "${ctx.provider}" not yet supported in LangChain adapter.`);
  };

  return { resolved, getModel };
}

// ─── AgentIdentityCallbackHandler ────────────────────────────────────────────────

/**
 * LangChain callback handler that records agent-identity resolution metadata
 * into each LLM run's metadata. Drop this into any LangChain chain or agent
 * to get automatic credential tracing without modifying the chain itself.
 *
 * Example:
 *   const handler = new AgentIdentityCallbackHandler(resolved, logger);
 *   await model.invoke(messages, { callbacks: [handler] });
 */
export class AgentIdentityCallbackHandler extends BaseCallbackHandler {
  readonly name = 'AgentIdentityCallbackHandler';

  constructor(
    private readonly resolved: ResolvedCredential,
    private readonly logger?: AuditLogger
  ) {
    super();
  }

  async handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>
  ): Promise<void> {
    if (extraParams) {
      extraParams['agentIdentityCredentialId'] = this.resolved.credentialId;
      extraParams['agentIdentityResolvedFor'] = this.resolved.resolvedFor;
    }
    // logger.log() is called by the router at resolve time; no duplicate log here
    void runId;
  }

  async handleLLMEnd(_output: LLMResult, _runId: string): Promise<void> {
    // Extension point: log token usage, latency, etc.
  }

  async handleLLMError(error: Error, _runId: string): Promise<void> {
    console.warn('[agent-identity] LLM error with credential', this.resolved.ref, error.message);
  }
}

// ─── createAgentIdentityNode (LangGraph) ────────────────────────────────────────

/**
 * Drop-in LangGraph StateGraph node that resolves credentials before any
 * LLM call in the graph. Attaches resolvedCredential to the state so
 * downstream nodes can use it without repeating resolution.
 *
 * Example:
 *   const graph = new StateGraph(...);
 *   graph.addNode('resolve-creds', createAgentIdentityNode(credentials, rules));
 *   graph.addEdge('resolve-creds', 'llm-call');
 */
export function createAgentIdentityNode(
  credentials: Credential[],
  rules: RoutingRule[],
  logger?: AuditLogger
) {
  const router = createRouter(credentials, rules, logger);

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const ctx = state['agentContext'] as AgentRequestContext | undefined;
    if (!ctx) throw new Error('[agent-identity/langchain] state.agentContext is required');

    const resolved = router.resolve(ctx);
    if (!resolved) throw new Error(`[agent-identity/langchain] No credential resolved for context: ${JSON.stringify(ctx)}`);

    return { ...state, resolvedCredential: resolved };
  };
}
