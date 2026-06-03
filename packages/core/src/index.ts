/**
 * @datacules/agent-identity — public API
 *
 * Provider-agnostic credential routing and identity management for AI agents.
 * The model/LLM layer never receives raw credentials.
 *
 * @example
 * ```typescript
 * import { createRouter } from '@datacules/agent-identity';
 * import type { AgentRequestContext } from '@datacules/agent-identity';
 *
 * const router = createRouter(credentials, rules, logger);
 * const resolved = await router.resolveAsync(ctx);
 * ```
 */

// ─── Types (type-only re-export — required by isolatedModules) ───────────────────
// types.ts has ONLY interfaces and type aliases — no runtime values.
// 'export type *' is mandatory under isolatedModules: true (TS1205).
export type * from './types';

// ─── Runtime modules (classes, functions, const) ─────────────────────────────
// Core router + built-in stores
export * from './router';
export * from './providers';
export * from './credentials';
export * from './decision';
export * from './rotation';
export * from './attestation';
export * from './approval';
export * from './budget';
export * from './federation';

// auth.md compatibility — identity providers, revocation, and claim lifecycle
export * from './identity-providers';
export * from './revocation';
export * from './revocation-listener';
