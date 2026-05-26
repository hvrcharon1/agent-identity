/**
 * Express middleware for @datacules/agent-identity.
 *
 * Resolves credentials before any downstream route handler runs.
 * The resolved credential is attached to req.resolvedCredential.
 *
 * Usage:
 *   import express from 'express';
 *   import { agentIdentityMiddleware } from '@datacules/agent-identity-express';
 *
 *   const app = express();
 *   app.use(express.json());
 *   app.use(agentIdentityMiddleware({ credentials, rules, logger }));
 *
 *   app.post('/ai/complete', (req, res) => {
 *     const cred = req.resolvedCredential; // already resolved
 *   });
 */
import { createRouter } from '@datacules/agent-identity';
import type {
  AgentRequestContext,
  AuditLogger,
  Credential,
  ResolvedCredential,
  RoutingRule,
} from '@datacules/agent-identity';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      resolvedCredential?: ResolvedCredential;
    }
  }
}

export interface AgentIdentityMiddlewareOptions {
  credentials: Credential[];
  rules: RoutingRule[];
  logger?: AuditLogger;
  /**
   * Key in req.body that holds the AgentRequestContext.
   * Default: 'agentContext'
   */
  contextKey?: string;
  /**
   * If true, the middleware passes through when no agentContext is found
   * rather than returning 400. Use when the middleware is global and only
   * some routes are agent-identity-aware.
   * Default: true
   */
  passThrough?: boolean;
}

export function agentIdentityMiddleware(options: AgentIdentityMiddlewareOptions) {
  const {
    credentials,
    rules,
    logger,
    contextKey = 'agentContext',
    passThrough = true,
  } = options;

  const router = createRouter(credentials, rules, logger);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.body?.[contextKey] as AgentRequestContext | undefined;

    if (!ctx) {
      if (passThrough) return next();
      res.status(400).json({ error: `Missing required field: ${contextKey}` });
      return;
    }

    const resolved = router.resolve(ctx);
    if (!resolved) {
      res.status(403).json({ error: 'No credential resolved for this context' });
      return;
    }

    req.resolvedCredential = resolved;
    next();
  };
}
