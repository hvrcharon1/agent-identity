/**
 * LangGraph node helpers — wrap any LangGraph StateGraph node function so it
 * resolves credentials before executing its own logic.
 *
 * Usage with LangGraph:
 *
 *   import { StateGraph, END } from '@langchain/langgraph';
 *   import { wrapWithAgentIdentity } from '@datacules/agent-identity-langchain';
 *   import { createRouter } from '@datacules/agent-identity';
 *
 *   const router = createRouter(credentials, rules);
 *
 *   // Your graph state shape
 *   interface MyState {
 *     agentCtx: AgentRequestContext;
 *     messages: string[];
 *     _resolvedCredential?: ResolvedCredential;
 *   }
 *
 *   // Original node function
 *   async function fetchDataNode(state: MyState) {
 *     const cred = state._resolvedCredential!;
 *     // use cred.resolvedFor to tag the downstream request
 *     return { messages: [...state.messages, 'fetched'] };
 *   }
 *
 *   // Wrap it — credential is resolved and injected into state before the node runs
 *   const wrappedNode = wrapWithAgentIdentity(router, fetchDataNode, {
 *     extractCtx: (state) => state.agentCtx,
 *   });
 *
 *   const graph = new StateGraph<MyState>({ channels: ... })
 *     .addNode('fetchData', wrappedNode)
 *     .addEdge(START, 'fetchData')
 *     .addEdge('fetchData', END)
 *     .compile();
 */
import type { CredentialRouter, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

export interface WrapWithAgentIdentityOptions<TState extends Record<string, unknown>> {
  /**
   * Extract an AgentRequestContext from the graph state.
   * The credential will be resolved using this context before the node runs.
   */
  extractCtx: (state: TState) => AgentRequestContext;
  /**
   * Key under which the resolved credential is written into the state update
   * returned by the wrapper. Default: '_resolvedCredential'
   */
  credentialKey?: string;
}

export type LangGraphNodeFn<TState> = (
  state: TState
) => Promise<Partial<TState>>;

/**
 * Wraps a LangGraph node function with credential resolution.
 *
 * The wrapper:
 *   1. Calls router.resolveAsync(ctx) using the AgentRequestContext extracted from state
 *   2. Injects the resolved credential into the state update under `credentialKey`
 *   3. Calls the original node function with the enriched state (credential already in state)
 *   4. Merges the credential key into the node's returned state patch
 *
 * This means the credential is available both inside the node (via `state[credentialKey]`
 * after the first run) and to downstream nodes (via the state patch).
 */
export function wrapWithAgentIdentity<TState extends Record<string, unknown>>(
  router: CredentialRouter,
  nodeFn: LangGraphNodeFn<TState>,
  options: WrapWithAgentIdentityOptions<TState>
): LangGraphNodeFn<TState> {
  const { extractCtx, credentialKey = '_resolvedCredential' } = options;

  return async (state: TState): Promise<Partial<TState>> => {
    const ctx: AgentRequestContext = extractCtx(state);

    const resolved: ResolvedCredential | null = await router.resolveAsync(ctx);
    if (!resolved) {
      throw new Error(
        `[wrapWithAgentIdentity] No credential resolved for node. ` +
          `resourceId="${ctx.resourceId}" provider="${ctx.provider}" action="${ctx.action}"`
      );
    }

    // Enrich state so the inner node can read the credential immediately
    const enrichedState: TState = { ...state, [credentialKey]: resolved };
    const nodePatch = await nodeFn(enrichedState);

    // Always propagate the credential in the state patch so downstream nodes see it
    return { ...nodePatch, [credentialKey]: resolved };
  };
}
