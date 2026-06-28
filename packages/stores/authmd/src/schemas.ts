/**
 * schemas.ts — Zod schemas for auth.md store user-facing config types.
 *
 * Runtime-validates AgentAuthMdConfig entries before they are passed
 * to AgentAuthMdStore. The store itself does not call these; consumers
 * (CLI, API routes, tests) use them at config parse time.
 */
import { z } from 'zod';

export const AgentAuthMdMethodSchema = z.enum(['id-jag', 'service-auth', 'verified-email', 'anonymous']);

export const AgentAuthMdConfigSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(['fixed', 'user-delegated']),
  name: z.string().min(1),
  scope: z.string(),
  status: z.enum(['active', 'pending', 'revoked']),
  provider: z.string().optional(),
  tags: z.array(z.string()).optional(),
  resourceServerUrl: z.string().url(),
  methodPreference: z.array(AgentAuthMdMethodSchema).optional(),
  userEmail: z.string().email().optional(),
  expiryBufferMs: z.number().int().nonnegative().optional(),
  // idJagProvider is intentionally omitted — it is a live object, not serialisable.
});

export const AgentAuthMdStoreOptionsSchema = z.object({
  configs: z.array(AgentAuthMdConfigSchema),
});

export type AgentAuthMdConfigInput = z.infer<typeof AgentAuthMdConfigSchema>;
export type AgentAuthMdStoreOptionsInput = z.infer<typeof AgentAuthMdStoreOptionsSchema>;
