/**
 * @datacules/agent-identity-express
 *
 * Express middleware for @datacules/agent-identity.
 *
 * Exports:
 *   agentIdentityMiddleware — RequestHandler that resolves a credential before
 *                             the route handler and attaches it to req.agentIdentity
 */
export { agentIdentityMiddleware } from './middleware';
export type { AgentIdentityMiddlewareOptions } from './middleware';
