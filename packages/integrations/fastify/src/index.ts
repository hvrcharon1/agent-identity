/**
 * Fastify plugin for @datacules/agent-identity.
 *
 * Decorates each request with resolvedCredential before the route handler runs.
 *
 * Usage:
 *   import Fastify from 'fastify';
 *   import { agentIdentityPlugin } from '@datacules/agent-identity-fastify';
 *
 *   const app = Fastify();
 *   await app.register(agentIdentityPlugin, { credentials, rules, logger });
 *
 *   app.post('/ai/complete', async (request, reply) => {
 *     const cred = request.resolvedCredential; // typed
 *   });
 */
import fp from 'fastify-plugin';
import { createRouter } from '@datacules/agent-identity';
import type {
  AgentRequestContext,
  AuditLogger,
  Credential,
  ResolvedCredential,
  RoutingRule,
} from '@datacules/agent-identity';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    resolvedCredential: ResolvedCredential | null;
  }
}

export interface AgentIdentityPluginOptions {
  credentials: Credential[];
  rules: RoutingRule[];
  logger?: AuditLogger;
  contextKey?: string;
  passThrough?: boolean;
}

const plugin: FastifyPluginAsync<AgentIdentityPluginOptions> = async (fastify, options) => {
  const {
    credentials,
    rules,
    logger,
    contextKey = 'agentContext',
    passThrough = true,
  } = options;

  const router = createRouter(credentials, rules, logger);

  fastify.decorateRequest('resolvedCredential', null);

  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | null;
      const ctx = body?.[contextKey] as AgentRequestContext | undefined;

      if (!ctx) {
        if (!passThrough) {
          return reply.status(400).send({ error: `Missing required field: ${contextKey}` });
        }
        return;
      }

      const resolved = router.resolve(ctx);
      if (!resolved) {
        return reply.status(403).send({ error: 'No credential resolved for this context' });
      }

      request.resolvedCredential = resolved;
    }
  );
};

export const agentIdentityPlugin = fp(plugin, {
  name: '@datacules/agent-identity-fastify',
  fastify: '>=4.0.0',
});
