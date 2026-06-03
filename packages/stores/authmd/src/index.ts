/**
 * @datacules/agent-identity-store-authmd — public API
 *
 * Re-exports everything consumers need:
 *   - AgentAuthMdStore (the CredentialStore implementation)
 *   - Types from types.ts
 *   - Zod schemas from schemas.ts
 *   - Discovery helpers from discovery.ts
 */
export { AgentAuthMdStore } from './AgentAuthMdStore';
export type {
  AgentAuthMdMethod,
  ProtectedResourceMetadata,
  AgentAuthBlock,
  AuthServerMetadata,
  AgentAuthMdConfig,
  IdJagProvider,
  AgentAuthMdStoreOptions,
  RegistrationResponse,
  ClaimCeremonyResponse,
} from './types';
export {
  AgentAuthMdMethodSchema,
  AgentAuthMdConfigSchema,
  AgentAuthMdStoreOptionsSchema,
} from './schemas';
export type {
  AgentAuthMdConfigInput,
  AgentAuthMdStoreOptionsInput,
} from './schemas';
export { discoverService, fetchASMetadata } from './discovery';
