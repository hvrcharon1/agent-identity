/**
 * MCP tool handler implementations for @datacules/agent-identity.
 *
 * Each exported function corresponds to one MCP tool:
 *   resolve_credential        — resolves credential for AgentRequestContext
 *   resolve_migration_credential — resolves source+target pair for MigrationContext
 *   list_credentials          — lists active credentials (safe metadata, no raw refs)
 *   list_rules                — lists routing rules
 *   health                    — liveness check
 *
 * Tool schemas use Zod and are exported as McpToolSchema objects so the
 * server index can register them with a single loop.
 */

import { z } from 'zod';
import { createRouterFromStore, MemoryCredentialStore } from '@datacules/agent-identity';
import type {
  AuditLogger,
  Credential,
  CredentialStore,
  RoutingRule,
} from '@datacules/agent-identity';

// ─── Shared Zod schemas ───────────────────────────────────────────────────────

const SupportedProviderSchema = z.enum(['openai', 'anthropic', 'gemini', 'mistral', 'local']);
const ResourceKindSchema = z.enum(['shared', 'personal']);
const MigrationPhaseSchema = z.enum(['dry-run', 'extract', 'transform', 'load', 'verify', 'rollback']);

const BaseContextSchema = z.object({
  userId: z.string().min(1),
  resourceId: z.string().min(1),
  resourceKind: ResourceKindSchema,
  provider: SupportedProviderSchema,
  model: z.string().min(1),
  action: z.string().min(1),
  traceId: z.string().min(1),
  sessionId: z.string().optional(),
  requestedAt: z.string().optional(),
  parentTraceId: z.string().optional(),
  mcpSessionId: z.string().optional(),
  mcpClientId: z.string().optional(),
});

const ResolveCredentialSchema = BaseContextSchema;

const ResolveMigrationSchema = BaseContextSchema.extend({
  migrationId: z.string().min(1),
  phase: MigrationPhaseSchema,
  sourceResourceId: z.string().min(1),
  targetResourceId: z.string().min(1),
  batchIndex: z.number().int().nonnegative().optional(),
  totalBatches: z.number().int().positive().optional(),
  dryRun: z.boolean(),
});

// ─── Tool descriptor type ─────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown, deps: ToolDeps) => Promise<McpToolResult>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDeps {
  store: CredentialStore;
  rules: RoutingRule[];
  logger?: AuditLogger;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// ─── resolve_credential ───────────────────────────────────────────────────────

const resolveCredentialTool: McpToolDefinition = {
  name: 'resolve_credential',
  description:
    'Resolve the correct credential for an agent request. ' +
    'Provide the full AgentRequestContext (userId, resourceId, resourceKind, provider, model, action, traceId). ' +
    'Returns the resolved credential metadata — never the raw secret.',
  inputSchema: ResolveCredentialSchema,
  async handler(input, { store, rules, logger }) {
    const parsed = ResolveCredentialSchema.safeParse(input);
    if (!parsed.success) return err(`Validation error: ${parsed.error.message}`);

    const ctx = {
      ...parsed.data,
      requestedAt: parsed.data.requestedAt ?? new Date().toISOString(),
    };

    const router = createRouterFromStore(store, rules, logger);
    const resolved = router.resolve(ctx);
    if (!resolved) return err('No credential resolved — no routing rule matched this context.');

    return ok({
      ok: true,
      credentialId: resolved.credentialId,
      kind: resolved.kind,
      resolvedFor: resolved.resolvedFor,
      // ref is intentionally omitted — never surface raw refs over MCP
    });
  },
};

// ─── resolve_migration_credential ─────────────────────────────────────────────

const resolveMigrationCredentialTool: McpToolDefinition = {
  name: 'resolve_migration_credential',
  description:
    'Resolve source and target credentials for a data migration workflow. ' +
    'Requires a full MigrationContext including migrationId, phase, sourceResourceId, targetResourceId, and dryRun flag. ' +
    'Returns both resolved credential metadata objects — never raw secrets.',
  inputSchema: ResolveMigrationSchema,
  async handler(input, { store, rules, logger }) {
    const parsed = ResolveMigrationSchema.safeParse(input);
    if (!parsed.success) return err(`Validation error: ${parsed.error.message}`);

    const ctx = {
      ...parsed.data,
      requestedAt: parsed.data.requestedAt ?? new Date().toISOString(),
    };

    const router = createRouterFromStore(store, rules, logger);
    const pair = router.resolvePair(ctx);
    if (!pair) return err('No credential pair resolved — check that routing rules cover both sourceResourceId and targetResourceId.');

    return ok({
      ok: true,
      migrationId: pair.migrationId,
      source: { credentialId: pair.source.credentialId, kind: pair.source.kind, resolvedFor: pair.source.resolvedFor },
      target: { credentialId: pair.target.credentialId, kind: pair.target.kind, resolvedFor: pair.target.resolvedFor },
      expiresAt: pair.expiresAt ?? null,
    });
  },
};

// ─── list_credentials ─────────────────────────────────────────────────────────

const listCredentialsTool: McpToolDefinition = {
  name: 'list_credentials',
  description:
    'List all active credentials registered with this agent-identity server. ' +
    'Returns safe metadata only (id, kind, name, scope, status, expiresAt). ' +
    'Raw refs and secrets are never included.',
  inputSchema: z.object({
    kind: z.enum(['fixed', 'user-delegated']).optional().describe('Filter by credential kind'),
  }),
  async handler(input, { store }) {
    const parsed = z.object({ kind: z.enum(['fixed', 'user-delegated']).optional() }).safeParse(input);
    if (!parsed.success) return err(`Validation error: ${parsed.error.message}`);

    const creds = parsed.data.kind
      ? await store.listByKind(parsed.data.kind)
      : await store.listActive();

    const safe = creds.map(({ id, kind, name, scope, status, expiresAt }) => ({
      id, kind, name, scope, status, expiresAt: expiresAt ?? null,
    }));

    return ok({ count: safe.length, credentials: safe });
  },
};

// ─── list_rules ───────────────────────────────────────────────────────────────

const listRulesTool: McpToolDefinition = {
  name: 'list_rules',
  description:
    'List all routing rules registered with this agent-identity server, ' +
    'ordered by priority (highest first). Useful for debugging credential routing.',
  inputSchema: z.object({}),
  async handler(_input, { rules }) {
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    return ok({ count: sorted.length, rules: sorted });
  },
};

// ─── health ───────────────────────────────────────────────────────────────────

const healthTool: McpToolDefinition = {
  name: 'health',
  description: 'Check whether the agent-identity MCP server is healthy and how many credentials/rules are loaded.',
  inputSchema: z.object({}),
  async handler(_input, { store, rules }) {
    const active = await store.listActive();
    return ok({
      status: 'ok',
      credentialsLoaded: active.length,
      rulesLoaded: rules.length,
      timestamp: new Date().toISOString(),
    });
  },
};

// ─── Export all tools ─────────────────────────────────────────────────────────

export const ALL_TOOLS: McpToolDefinition[] = [
  resolveCredentialTool,
  resolveMigrationCredentialTool,
  listCredentialsTool,
  listRulesTool,
  healthTool,
];
