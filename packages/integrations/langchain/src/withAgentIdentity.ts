/**
 * withAgentIdentity — an LCEL RunnableLambda wrapper that injects a
 * resolved credential into the chain's input before it reaches downstream
 * runnables (e.g. a ChatModel or retriever).
 *
 * Works with any LCEL chain (pipe, RunnableSequence, RunnableMap, etc.).
 *
 * Usage:
 *
 *   import { withAgentIdentity } from '@datacules/agent-identity-langchain';
 *   import { ChatAnthropic } from '@langchain/anthropic';
 *   import { createRouter } from '@datacules/agent-identity';
 *
 *   const router = createRouter(credentials, rules);
 *
 *   const chain = withAgentIdentity(router, {
 *     extractCtx: (input) => input.agentCtx,
 *   }).pipe(myChain);
 *
 *   const result = await chain.invoke({ agentCtx: ctx, question: 'Hello' });
 *
 * The wrapper adds `_resolvedCredential` to the input object before passing
 * it downstream. Downstream runnables can read it to add user-id headers, etc.
 */
import type { CredentialRouter, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

export interface WithAgentIdentityOptions<TInput extends Record<string, unknown>> {
  /**
   * Extract an AgentRequestContext from the chain's input object.
   * If omitted, the entire input is treated as an AgentRequestContext.
   */
  extractCtx?: (input: TInput) => AgentRequestContext;
  /**
   * Key under which the resolved credential is injected into the input.
   * Default: '_resolvedCredential'
   */
  injectKey?: string;
}

export type WithAgentIdentityOutput<TInput extends Record<string, unknown>> =
  TInput & { _resolvedCredential: ResolvedCredential };

/**
 * Returns a plain async function that resolves the credential and merges it
 * into the input. Pass it to RunnableLambda.from() from @langchain/core.
 *
 * We return a raw function (not a RunnableLambda) to avoid a hard import of
 * @langchain/core at this level. Callers wrap it themselves:
 *
 *   import { RunnableLambda } from '@langchain/core/runnables';
 *   const step = RunnableLambda.from(withAgentIdentity(router, opts));
 */
export function withAgentIdentity<TInput extends Record<string, unknown>>(
  router: CredentialRouter,
  options: WithAgentIdentityOptions<TInput> = {}
): (input: TInput) => Promise<WithAgentIdentityOutput<TInput>> {
  const { extractCtx, injectKey = '_resolvedCredential' } = options;

  return async (input: TInput): Promise<WithAgentIdentityOutput<TInput>> => {
    const ctx: AgentRequestContext = extractCtx
      ? extractCtx(input)
      : (input as unknown as AgentRequestContext);

    const resolved = await router.resolveAsync(ctx);
    if (!resolved) {
      throw new Error(
        `[withAgentIdentity] No credential resolved for resourceId="${ctx.resourceId}" ` +
          `provider="${ctx.provider}" action="${ctx.action}"`
      );
    }

    return { ...input, [injectKey]: resolved } as WithAgentIdentityOutput<TInput>;
  };
}
