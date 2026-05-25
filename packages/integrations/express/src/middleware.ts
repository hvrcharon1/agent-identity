/**
 * agentIdentityMiddleware — Express middleware that resolves a credential
 * before the request reaches the route handler.
 *
 * Attaches the resolved credential to `req.agentIdentity` so downstream
 * handlers can read it without another round-trip.
 *
 * Usage:
 *
 *   import express from 'express';
 *   import { agentIdentityMiddleware } from '@datacules/agent-identity-express';
 *   import { createRouter } from '@datacules/agent-identity';
 *
 *   const router = createRouter(credentials, rules);
 *
 *   app.use(
 *     agentIdentityMiddleware(router, {
 *       extractCtx: (req) => ({
 *         userId:       req.user.id,
 *         resourceId:   req.params.resourceId,
 *         resourceKind: 'shared',
 *         provider:     'anthropic',
 *         model:        'claude-sonnet-4-20250514',
 *         action:       req.method === 'GET' ? 'read' : 'write',
 *         traceId:      req.headers['x-trace-id'] as string,
 *         requestedAt:  new Date().toISOString(),
 *       }),
 *     })
 *   );
 *
 *   app.post('/chat', (req, res) => {
 *     const cred = req.agentIdentity; // ResolvedCredential | undefined
 *     res.json({ resolvedFor: cred?.resolvedFor });
 *   });
 *
 * TypeScript users: extend the Express Request interface:
 *
 *   declare global {
 *     namespace Express {
 *       interface Request {
 *         agentIdentity?: import('@datacules/agent-identity').ResolvedCredential;
 *       }
 *     }
 *   }
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { CredentialRouter, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

const AGENT_IDENTITY_KEY = 'agentIdentity';

export interface AgentIdentityMiddlewareOptions {
  /**
   * Build an AgentRequestContext from the incoming Express request.
   * Required — the middleware cannot guess your userId, traceId, etc.
   */
  extractCtx: (req: Request) => AgentRequestContext;
  /**
   * When true, a 403 is returned if no credential is resolved.
   * When false, next() is called even without a resolved credential
   * (req.agentIdentity will be undefined).
   * Default: true
   */
  required?: boolean;
  /**
   * Custom property name on req to store the resolved credential.
   * Default: 'agentIdentity'
   */
  requestKey?: string;
}

/**
 * Returns an Express RequestHandler that resolves a credential and attaches
 * it to the request before calling next().
 */
export function agentIdentityMiddleware(
  router: CredentialRouter,
  options: AgentIdentityMiddlewareOptions
): RequestHandler {
  const { extractCtx, required = true, requestKey = AGENT_IDENTITY_KEY } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = extractCtx(req);
      const resolved: ResolvedCredential | null = await router.resolveAsync(ctx);

      if (!resolved) {
        if (required) {
          res.status(403).json({ error: 'No credential resolved for this request context' });
          return;
        }
        next();
        return;
      }

      // Attach to request — downstream handlers read req.agentIdentity
      (req as Request & Record<string, unknown>)[requestKey] = resolved;
      next();
    } catch (err) {
      next(err);
    }
  };
}
