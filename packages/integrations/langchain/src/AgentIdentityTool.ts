/**
 * AgentIdentityTool — a LangChain StructuredTool that resolves a credential
 * for a given AgentRequestContext and returns a sanitised result to the agent.
 *
 * The tool never exposes the raw secret — it calls the /api/resolve endpoint
 * (or a configured base URL) and returns only `resolvedFor` + `expiresAt`.
 *
 * Usage in a LangChain agent:
 *
 *   import { AgentIdentityTool } from '@datacules/agent-identity-langchain';
 *
 *   const tool = new AgentIdentityTool({
 *     resolveEndpoint: 'http://localhost:3001/api/resolve',
 *   });
 *
 *   const agent = await createReactAgent({ llm, tools: [tool] });
 *
 * The LLM calls the tool by providing a JSON object that matches
 * AgentRequestContext; the tool validates it, calls /api/resolve, and
 * returns the resolved identity string back into the agent loop.
 */
import { z } from 'zod';
import type {
  AgentRequestContext,
  ResolvedCredential,
  CredentialRouter,
} from '@datacules/agent-identity';

// StructuredTool is defined by @langchain/core; we import lazily to keep
// the peer dependency optional at type-check time for consumers that bundle
// their own version.
import type { StructuredToolInterface } from '@langchain/core/tools';

// ─── Input schema (matches AgentRequestContextSchema) ─────────────────────────

const AgentIdentityToolInputSchema = z.object({
  userId:       z.string().min(1).describe('User or service account making the request'),
  resourceId:   z.string().min(1).describe('Resource being accessed'),
  resourceKind: z.enum(['shared', 'personal']).describe('Shared or personal resource'),
  provider:     z.enum(['openai', 'anthropic', 'gemini', 'mistral', 'local']).describe('AI provider'),
  model:        z.string().min(1).describe('Model name as used by the provider API'),
  action:       z.string().min(1).describe('Operation: read, write, delete, etc.'),
  traceId:      z.string().min(1).describe('Distributed trace ID for the current agent run'),
  sessionId:    z.string().optional().describe('Session grouping identifier (optional)'),
  requestedAt:  z.string().datetime().describe('ISO 8601 timestamp of the request'),
});

export type AgentIdentityToolInput = z.infer<typeof AgentIdentityToolInputSchema>;

// ─── Options ───────────────────────────────────────────────────────────────────

export interface AgentIdentityToolOptions {
  /**
   * Full URL of the resolve endpoint.
   * Default: 'http://localhost:3001/api/resolve'
   */
  resolveEndpoint?: string;
  /**
   * Alternatively, supply an in-process CredentialRouter to skip the HTTP round-trip.
   * When both are provided, the router takes precedence.
   */
  router?: CredentialRouter;
  /**
   * Optional fetch override (useful for testing).
   */
  fetchFn?: typeof fetch;
}

// ─── AgentIdentityTool ──────────────────────────────────────────────────────────

/**
 * LangChain StructuredTool that resolves agent credentials.
 *
 * Implements the StructuredToolInterface from @langchain/core so it plugs
 * directly into any LangChain agent executor or LCEL chain.
 *
 * The class does NOT extend StructuredTool directly to avoid a hard
 * compile-time dependency on a specific @langchain/core version. It
 * satisfies StructuredToolInterface at the type level so TypeScript
 * consumers get full autocompletion.
 */
export class AgentIdentityTool implements Partial<StructuredToolInterface> {
  readonly name = 'agent_identity_resolve';
  readonly description =
    'Resolves the correct credential identity for an AI agent request. ' +
    'Call this at the start of any tool chain that accesses a protected resource. ' +
    'Returns the resolved identity string and optional expiry time.';
  readonly schema = AgentIdentityToolInputSchema;

  private readonly endpoint: string;
  private readonly router?: CredentialRouter;
  private readonly fetchFn: typeof fetch;

  constructor(options: AgentIdentityToolOptions = {}) {
    this.endpoint = options.resolveEndpoint ?? 'http://localhost:3001/api/resolve';
    this.router   = options.router;
    this.fetchFn  = options.fetchFn ?? globalThis.fetch;
  }

  async invoke(input: AgentIdentityToolInput): Promise<string> {
    // Fast path: in-process router (no HTTP overhead)
    if (this.router) {
      const ctx: AgentRequestContext = { ...input, parentTraceId: undefined };
      const resolved: ResolvedCredential | null = await this.router.resolveAsync(ctx);
      if (!resolved) {
        throw new Error(
          `[AgentIdentityTool] No credential resolved for resourceId="${input.resourceId}" ` +
            `provider="${input.provider}" action="${input.action}"`
        );
      }
      return JSON.stringify({ resolvedFor: resolved.resolvedFor });
    }

    // HTTP path: call the sidecar / Next.js endpoint
    const res = await this.fetchFn(this.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(
        `[AgentIdentityTool] /api/resolve returned ${res.status}: ${body.error ?? 'unknown error'}`
      );
    }

    const data = await res.json() as { resolvedFor: string; expiresAt?: string };
    // Return a concise JSON string that the LLM can read in the next step
    return JSON.stringify({
      resolvedFor: data.resolvedFor,
      expiresAt:   data.expiresAt ?? null,
    });
  }

  // LangChain also calls _call on older executors — alias for compatibility
  async _call(input: AgentIdentityToolInput): Promise<string> {
    return this.invoke(input);
  }
}
