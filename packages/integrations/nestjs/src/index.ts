/**
 * @datacules/agent-identity-nestjs
 *
 * NestJS module, injectable service, guard, and parameter decorator
 * for @datacules/agent-identity.
 *
 * Exports:
 *   AgentIdentityModule    — DynamicModule (use forRoot / forRootAsync)
 *   AgentIdentityService   — Injectable service wrapping CredentialRouter
 *   AgentIdentityGuard     — CanActivate guard; resolves credential before handler
 *   ResolvedCredential     — Parameter decorator to read the resolved credential
 *   RESOLVED_CREDENTIAL_KEY— Request property key set by the guard
 */
export { AgentIdentityModule } from './AgentIdentityModule';
export { AgentIdentityService } from './AgentIdentityService';
export type { AgentIdentityModuleOptions } from './AgentIdentityService';
export type { AgentIdentityAsyncOptions } from './AgentIdentityModule';
export { AgentIdentityGuard } from './AgentIdentityGuard';
export { ResolvedCredential, RESOLVED_CREDENTIAL_KEY } from './ResolvedCredential';
