/**
 * @datacules/agent-identity-fastify
 *
 * Fastify plugin for @datacules/agent-identity.
 *
 * Exports:
 *   agentIdentityPlugin          — FastifyPluginAsync to register globally
 *   AgentIdentityPluginOptions   — Plugin configuration type
 */
export { agentIdentityPlugin } from './plugin';
export type { AgentIdentityPluginOptions } from './plugin';
export { agentIdentityPlugin as default } from './plugin';
