/**
 * mcp.test.ts
 *
 * Vitest test suite for the MCP tool handler functions in
 * packages/integrations/mcp/src/tools.ts.
 *
 * tools.ts imports only zod and @datacules/agent-identity — it does NOT
 * import @modelcontextprotocol/sdk (that is in index.ts and transports.ts).
 * Each tool's handler function is called directly with a ToolDeps object
 * containing a MemoryCredentialStore and routing rules, so no MCP SDK runtime
 * or network connection is required.
 *
 * 14 test cases:
 *   resolve_credential (4)
 *   resolve_migration_credential (3)
 *   list_credentials (3)
 *   list_rules (2)
 *   health (2)
 */
import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from './tools';
import { MemoryCredentialStore } from '@datacules/agent-identity';
import type { Credential, RoutingRule } from '@datacules/agent-identity';
import type { ToolDeps } from './tools';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CREDENTIALS: Credential[] = [
  {
    id: 'cred-openai',
    kind: 'fixed',
    name: 'OpenAI Prod Key',
    scope: 'read write',
    status: 'active',
    provider: 'openai',
    ref: 'openai-prod-key',
  },
  {
    id: 'cred-anthropic',
    kind: 'user-delegated',
    name: 'Anthropic User Token',
    scope: 'read',
    status: 'active',
    provider: 'anthropic',
    ref: 'anthropic-user-ref',
  },
];

const RULES: RoutingRule[] = [
  {
    id: 'rule-openai-shared',
    credentialRef: 'openai-prod-key',
    priority: 10,
    matchProvider: 'openai',
    matchResourceKind: 'shared',
  },
  {
    id: 'rule-anthropic-personal',
    credentialRef: 'anthropic-user-ref',
    priority: 20,
    matchProvider: 'anthropic',
    matchResourceKind: 'personal',
  },
];

/** Shared base context that satisfies BaseContextSchema */
const BASE_CTX = {
  userId: 'user-abc',
  resourceId: 'res-001',
  resourceKind: 'shared' as const,
  provider: 'openai' as const,
  model: 'gpt-4',
  action: 'complete',
  traceId: 'trace-xyz',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrideRules?: RoutingRule[]): ToolDeps {
  const store = new MemoryCredentialStore(CREDENTIALS);
  return { store, rules: overrideRules ?? RULES };
}

function getTool(name: string) {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool '${name}' not found in ALL_TOOLS`);
  return tool;
}

// ─── resolve_credential ───────────────────────────────────────────────────────

describe('resolve_credential tool', () => {
  it('returns credentialId, kind, and resolvedFor on successful resolution', async () => {
    const tool = getTool('resolve_credential');
    const result = await tool.handler(BASE_CTX, makeDeps());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.credentialId).toBe('cred-openai');
    expect(payload.kind).toBe('fixed');
    expect(payload.resolvedFor).toBe('service');
  });

  it('never includes the raw credential ref in the response', async () => {
    const tool = getTool('resolve_credential');
    const result = await tool.handler(BASE_CTX, makeDeps());

    const payload = JSON.parse(result.content[0].text);
    // 'ref' must not be present — it is the raw secret reference
    expect(payload.ref).toBeUndefined();
  });

  it('returns isError=true when no routing rule matches the context', async () => {
    const tool = getTool('resolve_credential');
    // gemini matches no configured rule
    const ctx = { ...BASE_CTX, provider: 'gemini' as const };
    const result = await tool.handler(ctx, makeDeps());

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/No credential resolved/i);
  });

  it('returns isError=true with Zod validation error when input is invalid', async () => {
    const tool = getTool('resolve_credential');
    // userId is required (min length 1) — empty string fails Zod
    const result = await tool.handler({ ...BASE_CTX, userId: '' }, makeDeps());

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/Validation error/i);
  });
});

// ─── resolve_migration_credential ─────────────────────────────────────────────

describe('resolve_migration_credential tool', () => {
  // Both source and target use provider:openai + resourceKind:shared,
  // which matches rule-openai-shared → cred-openai for both contexts.
  const MIGRATION_CTX = {
    ...BASE_CTX,
    migrationId: 'mig-001',
    phase: 'extract' as const,
    sourceResourceId: 'src-001',
    targetResourceId: 'tgt-001',
    dryRun: false,
  };

  it('returns source, target, and migrationId on successful pair resolution', async () => {
    const tool = getTool('resolve_migration_credential');
    const result = await tool.handler(MIGRATION_CTX, makeDeps());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.migrationId).toBe('mig-001');
    expect(payload.source.credentialId).toBe('cred-openai');
    expect(payload.target.credentialId).toBe('cred-openai');
  });

  it('returns isError=true when no credential pair can be resolved', async () => {
    const tool = getTool('resolve_migration_credential');
    // gemini matches no configured rule → pair returns null
    const ctx = { ...MIGRATION_CTX, provider: 'gemini' as const };
    const result = await tool.handler(ctx, makeDeps());

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/No credential pair resolved/i);
  });

  it('returns isError=true with Zod validation error when migrationId is missing', async () => {
    const tool = getTool('resolve_migration_credential');
    // Destructure out migrationId so the field is absent from the input object
    const { migrationId: _omit, ...withoutMigrationId } = MIGRATION_CTX;
    const result = await tool.handler(withoutMigrationId, makeDeps());

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/Validation error/i);
  });
});

// ─── list_credentials ─────────────────────────────────────────────────────────

describe('list_credentials tool', () => {
  it('returns all active credentials with safe metadata (no raw ref)', async () => {
    const tool = getTool('list_credentials');
    const result = await tool.handler({}, makeDeps());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(2);
    expect(payload.credentials[0]).toHaveProperty('id');
    expect(payload.credentials[0]).toHaveProperty('kind');
    expect(payload.credentials[0]).toHaveProperty('scope');
    // raw ref must never appear in list output
    expect(payload.credentials[0]).not.toHaveProperty('ref');
  });

  it('filters to only fixed credentials when kind=fixed is specified', async () => {
    const tool = getTool('list_credentials');
    const result = await tool.handler({ kind: 'fixed' }, makeDeps());

    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.credentials[0].kind).toBe('fixed');
    expect(payload.credentials[0].id).toBe('cred-openai');
  });

  it('filters to only user-delegated credentials when kind=user-delegated is specified', async () => {
    const tool = getTool('list_credentials');
    const result = await tool.handler({ kind: 'user-delegated' }, makeDeps());

    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.credentials[0].kind).toBe('user-delegated');
    expect(payload.credentials[0].id).toBe('cred-anthropic');
  });
});

// ─── list_rules ───────────────────────────────────────────────────────────────

describe('list_rules tool', () => {
  it('returns all rules sorted by priority descending', async () => {
    const tool = getTool('list_rules');
    const result = await tool.handler({}, makeDeps());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(2);
    // rule-anthropic-personal (priority 20) must come before rule-openai-shared (priority 10)
    expect(payload.rules[0].priority).toBeGreaterThanOrEqual(payload.rules[1].priority);
  });

  it('includes both rule ids in the result', async () => {
    const tool = getTool('list_rules');
    const result = await tool.handler({}, makeDeps());

    const payload = JSON.parse(result.content[0].text);
    const ids: string[] = payload.rules.map((r: { id: string }) => r.id);
    expect(ids).toContain('rule-openai-shared');
    expect(ids).toContain('rule-anthropic-personal');
  });
});

// ─── health ───────────────────────────────────────────────────────────────────

describe('health tool', () => {
  it('returns status: ok, credentialsLoaded, rulesLoaded, and a timestamp', async () => {
    const tool = getTool('health');
    const result = await tool.handler({}, makeDeps());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('ok');
    expect(payload.credentialsLoaded).toBe(2);
    expect(payload.rulesLoaded).toBe(2);
    expect(payload.timestamp).toBeDefined();
  });

  it('timestamp in health response is a valid ISO 8601 string', async () => {
    const tool = getTool('health');
    const result = await tool.handler({}, makeDeps());

    const payload = JSON.parse(result.content[0].text);
    // new Date().toISOString() must not throw and must round-trip cleanly
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });
});
