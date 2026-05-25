/**
 * agentIdentityPlugin — Fastify plugin that adds credential resolution to
 * every decorated route (or globally to all routes).
 *
 * The plugin:
 *   1. Adds a request decorator `request.agentIdentity` (ResolvedCredential | undefined)
 *   2. Registers an `onRequest` hook that resolves the credential before the handler runs
 *   3. Exposes a `fastify.resolveAgentIdentity(ctx)` decorator for manual use
 *
 * Usage (global — all routes):
 *
 *   import Fastify from 'fastify';
 *   import { agentIdentityPlugin } from '@datacules/agent-identity-fastify';
 *   import { createRouter } from '@datacules/agent-identity';
 *
 *   const app = Fastify();
 *   const router = createRouter(credentials, rules);
 *
 *   await app.register(agentIdentityPlugin, {
 *     router,
 *     extractCtx: (req) => ({
 *       userId:       (req.user as { id: string }).id,
 *       resourceId:   req.params.resourceId,
 *       resourceKind: 'shared',
 *       provider:     'anthropic',
 *       model:        'claude-sonnet-4-20250514',
 *       action:       req.method === 'GET' ? 'read' : 'write',
 *       traceId:      req.headers['x-trace-id'] as string,
 *       requestedAt:  new Date().toISOString(),
 *     }),
 *   });
 *
 *   app.post('/chat', async (req, reply) => {
 *     const cred = req.agentIdentity; // ResolvedCredential | undefined
 *     return { resolvedFor: cred?.resolvedFor };
 *   });
 *
 * Usage (per-route via preHandler hook):
 *
 *   app.post('/chat', {
 *     preHandler: app.resolveAgentIdentity,
 *   }, handler);
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { CredentialRouter, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

// Augment Fastify's type namespace
declare module 'fastify' {
  interface FastifyRequest {
    agentIdentity?: ResolvedCredential;
  }
  interface FastifyInstance {
    resolveAgentIdentity: (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

export interface AgentIdentityPluginOptions {
  /** The credential router to use for resolution. */
  router: CredentialRouter;
  /**
   * Build an AgentRequestContext from the incoming Fastify request.
   * Required — the plugin cannot guess your userId, traceId, etc.
   */
  extractCtx: (req: FastifyRequest) => AgentRequestContext;
  /**
   * When true, returns 403 if no credential is resolved.
   * When false, the handler runs even without a resolved credential
   * (req.agentIdentity will be undefined).
   * Default: true
   */
  required?: boolean;
  /**
   * When true, the onRequest hook is registered globally on the Fastify instance
   * (all routes are covered). When false, only the `resolveAgentIdentity`
   * preHandler decorator is added; routes opt in explicitly.
   * Default: true
   */
  global?: boolean;
}

export const agentIdentityPlugin: FastifyPluginAsync<AgentIdentityPluginOptions> = async (
  fastify,
  options
) => {
  const { router, extractCtx, required = true, global: isGlobal = true } = options;

  // Decorate the request with a placeholder
  fastify.decorateRequest('agentIdentity', undefined);

  // Core resolution logic (reused by both the hook and the preHandler decorator)
  const resolveAndAttach = async (
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const ctx: AgentRequestContext = extractCtx(req);
    const resolved: ResolvedCredential | null = await router.resolveAsync(ctx);

    if (!resolved) {
      if (required) {
        reply.code(403).send({ error: 'No credential resolved for this request context' });
        return;
      }
      return; // proceed without a credential
    }

    req.agentIdentity = resolved;
  };

  // Per-route preHandler decorator so routes can opt in explicitly:
  //   app.post('/chat', { preHandler: app.resolveAgentIdentity }, handler)
  fastify.decorate('resolveAgentIdentity', resolveAndAttach);

  // Global onRequest hook — runs before every handler
  if (isGlobal) {
    fastify.addHook('onRequest', resolveAndAttach);
  }
};

export default agentIdentityPlugin;
