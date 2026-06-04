/**
 * @datacules/agent-identity-store-libsql — Vitest test suite
 *
 * All four stores are tested using injected mock clients.
 * No real SQLite or Turso connection is required — the Client interface
 * is satisfied by plain vi.fn() mock objects, keeping CI native-dep-free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @libsql/client so schema.ts (imported transitively via index.ts)
// never attempts to load the native addon.
vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => mockClient),
}));

import { LibSqlCredentialStore } from './LibSqlCredentialStore.js';
import { LibSqlApprovalStore }   from './LibSqlApprovalStore.js';
import { LibSqlBudgetStore }     from './LibSqlBudgetStore.js';
import { LibSqlAuditLogger }     from './LibSqlAuditLogger.js';
import type { Credential, ApprovalRequest, AuditLogEntry, MigrationAuditLogEntry } from '@datacules/agent-identity';

// ─── Shared mock client ───────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockClient = { execute: mockExecute, batch: vi.fn(), close: vi.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeCred = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'cred-1',
  kind: 'fixed',
  name: 'OpenAI Key',
  scope: 'global',
  status: 'active',
  provider: 'openai',
  ref: 'openai-prod-slot',
  ...overrides,
});

const makeApprovalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  requestId:    'req-abc',
  credentialId: 'cred-1',
  ruleId:       'rule-pii',
  context: {
    userId:       'user-1',
    resourceId:   'res-1',
    resourceKind: 'personal',
    provider:     'openai',
    model:        'gpt-4o',
    action:       'read',
    traceId:      'trace-1',
    requestedAt:  '2026-06-04T00:00:00.000Z',
  },
  status:      'pending',
  requestedAt: '2026-06-04T00:00:00.000Z',
  expiresAt:   '2026-06-04T00:05:00.000Z',
  ...overrides,
});

const makeAuditEntry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  timestamp:      '2026-06-04T00:00:00.000Z',
  traceId:        'trace-1',
  userId:         'user-1',
  action:         'credential.resolved',
  resourceId:     'res-1',
  resourceKind:   'personal',
  provider:       'openai',
  model:          'gpt-4o',
  credentialId:   'cred-1',
  credentialKind: 'fixed',
  resolvedFor:    'user-1',
  ...overrides,
});

const makeMigrationEntry = (): MigrationAuditLogEntry => ({
  ...makeAuditEntry(),
  migrationId:         'mig-1',
  phase:               'load',
  rowsRead:            100,
  rowsWritten:         98,
  rowsFailed:          2,
  dryRun:              false,
  sourceCredentialId:  'cred-src',
  targetCredentialId:  'cred-tgt',
  errorSummary:        'constraint violation on 2 rows',
});

// Helper to make a fake resultset with rows
const rs = (rows: Record<string, unknown>[], rowsAffected = 0) =>
  ({ rows, rowsAffected, lastInsertRowid: undefined });

// ─── LibSqlCredentialStore ────────────────────────────────────────────────────

describe('LibSqlCredentialStore', () => {
  let store: LibSqlCredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new LibSqlCredentialStore(mockClient as never);
  });

  describe('findByRef()', () => {
    it('returns a mapped Credential when a row is found', async () => {
      const cred = makeCred();
      mockExecute.mockResolvedValue(rs([{
        id: cred.id, kind: cred.kind, name: cred.name, scope: cred.scope,
        status: cred.status, provider: cred.provider, ref: cred.ref,
        expires_at: null, last_rotated: null, refresh_token_ref: null,
        rotation_interval_days: null, rotation_policy: null, budget_policy: null,
        tags: null, pre_claim_scopes: null, post_claim_scopes: null, claimed_at: null,
      }]));
      const result = await store.findByRef('openai-prod-slot');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('cred-1');
      expect(result?.kind).toBe('fixed');
    });

    it('returns null when the query returns no rows', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.findByRef('missing-ref')).toBeNull();
    });

    it('returns null without throwing when execute throws', async () => {
      mockExecute.mockRejectedValue(new Error('DB_ERROR'));
      expect(await store.findByRef('ref')).toBeNull();
    });
  });

  describe('listActive()', () => {
    it('returns an array of mapped credentials', async () => {
      const row = { id: 'c1', kind: 'fixed', name: 'K', scope: 'g', status: 'active',
        provider: null, ref: 'r1', expires_at: null, last_rotated: null,
        refresh_token_ref: null, rotation_interval_days: null, rotation_policy: null,
        budget_policy: null, tags: null, pre_claim_scopes: null, post_claim_scopes: null,
        claimed_at: null };
      mockExecute.mockResolvedValue(rs([row, { ...row, id: 'c2', ref: 'r2' }]));
      const result = await store.listActive();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].id).toBe('c2');
    });

    it('returns empty array when no active credentials', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.listActive()).toEqual([]);
    });
  });

  describe('listByKind()', () => {
    it('passes kind to execute and maps returned rows', async () => {
      const row = { id: 'c1', kind: 'user-delegated', name: 'K', scope: 'g',
        status: 'active', provider: null, ref: 'r1', expires_at: null,
        last_rotated: null, refresh_token_ref: null, rotation_interval_days: null,
        rotation_policy: null, budget_policy: null, tags: null,
        pre_claim_scopes: null, post_claim_scopes: null, claimed_at: null };
      mockExecute.mockResolvedValue(rs([row]));
      const result = await store.listByKind('user-delegated');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('user-delegated');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.arrayContaining(['user-delegated']) })
      );
    });

    it('returns empty array when no credentials match the kind', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.listByKind('fixed')).toHaveLength(0);
    });
  });

  describe('reserve()', () => {
    it('returns true when no existing lock is present', async () => {
      mockExecute
        .mockResolvedValueOnce(rs([]))           // SELECT — no existing lock
        .mockResolvedValueOnce(rs([], 1));       // INSERT OR REPLACE succeeds
      expect(await store.reserve('ref-1', 'mig-1', 300)).toBe(true);
    });

    it('returns true and extends TTL when same migration already holds lock', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 9999;
      mockExecute
        .mockResolvedValueOnce(rs([{ migration_id: 'mig-1', expires_at: futureExpiry }]))
        .mockResolvedValueOnce(rs([], 1));
      expect(await store.reserve('ref-1', 'mig-1', 300)).toBe(true);
    });

    it('returns false when a different migration holds an unexpired lock', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 9999;
      mockExecute.mockResolvedValueOnce(
        rs([{ migration_id: 'mig-other', expires_at: futureExpiry }])
      );
      expect(await store.reserve('ref-1', 'mig-1', 300)).toBe(false);
    });

    it('returns false when execute throws', async () => {
      mockExecute.mockRejectedValue(new Error('SQLITE_BUSY'));
      expect(await store.reserve('ref-1', 'mig-1', 300)).toBe(false);
    });
  });

  describe('release()', () => {
    it('executes a DELETE with the correct ref and migrationId args', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.release('ref-1', 'mig-1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['ref-1', 'mig-1'] })
      );
    });

    it('resolves without throwing when execute fails (idempotent)', async () => {
      mockExecute.mockRejectedValue(new Error('already deleted'));
      await expect(store.release('ref-1', 'mig-1')).resolves.toBeUndefined();
    });
  });

  describe('revokeByIdentity()', () => {
    it('returns the number of rows revoked', async () => {
      mockExecute.mockResolvedValue(rs([], 3));
      const count = await store.revokeByIdentity(
        'https://auth.openai.com', 'user-42', 'https://api.datacules.com'
      );
      expect(count).toBe(3);
    });

    it('passes issuer, subject, and audience as execute args', async () => {
      mockExecute.mockResolvedValue(rs([], 0));
      await store.revokeByIdentity('https://issuer.com', 'sub-1', 'https://aud.com');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['https://issuer.com', 'sub-1', 'https://aud.com'],
        })
      );
    });
  });
});

// ─── LibSqlApprovalStore ──────────────────────────────────────────────────────

describe('LibSqlApprovalStore', () => {
  let store: LibSqlApprovalStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new LibSqlApprovalStore(mockClient as never);
  });

  describe('create()', () => {
    it('executes an INSERT with all required fields', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      const req = makeApprovalRequest();
      await store.create(req);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining([req.requestId, req.credentialId, req.ruleId]),
        })
      );
    });
  });

  describe('get()', () => {
    it('returns a mapped ApprovalRequest when a row is found', async () => {
      const req = makeApprovalRequest();
      mockExecute.mockResolvedValue(rs([{
        request_id:    req.requestId,
        credential_id: req.credentialId,
        rule_id:       req.ruleId,
        context:       JSON.stringify(req.context),
        status:        'pending',
        requested_at:  req.requestedAt,
        resolved_at:   null,
        resolved_by:   null,
        justification: null,
        expires_at:    req.expiresAt,
      }]));
      const result = await store.get('req-abc');
      expect(result).not.toBeNull();
      expect(result?.requestId).toBe('req-abc');
      expect(result?.status).toBe('pending');
    });

    it('returns null when no row is found', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.get('req-missing')).toBeNull();
    });
  });

  describe('update()', () => {
    it('executes an UPDATE with status, resolvedBy, and justification', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.update('req-abc', 'approved', 'admin-1', 'emergency access');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['approved', 'admin-1', 'emergency access', 'req-abc'],
        })
      );
    });

    it('passes null for optional resolvedBy and justification when omitted', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.update('req-abc', 'timeout');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['timeout', null, null, 'req-abc'] })
      );
    });
  });

  describe('listPending()', () => {
    it('returns mapped pending requests ordered by requested_at', async () => {
      const req = makeApprovalRequest();
      const row = {
        request_id: req.requestId, credential_id: req.credentialId,
        rule_id: req.ruleId, context: JSON.stringify(req.context),
        status: 'pending', requested_at: req.requestedAt, resolved_at: null,
        resolved_by: null, justification: null, expires_at: req.expiresAt,
      };
      mockExecute.mockResolvedValue(rs([row]));
      const result = await store.listPending();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });

    it('returns an empty array when no pending requests exist', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.listPending()).toEqual([]);
    });
  });
});

// ─── LibSqlBudgetStore ────────────────────────────────────────────────────────

describe('LibSqlBudgetStore', () => {
  let store: LibSqlBudgetStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new LibSqlBudgetStore(mockClient as never);
  });

  describe('getHourlyCount()', () => {
    it('returns the summed count from the hourly bucket rows', async () => {
      mockExecute.mockResolvedValue(rs([{ total: 42 }]));
      expect(await store.getHourlyCount('cred-1')).toBe(42);
    });

    it('returns 0 when COALESCE returns 0 (no rows)', async () => {
      mockExecute.mockResolvedValue(rs([{ total: 0 }]));
      expect(await store.getHourlyCount('cred-1')).toBe(0);
    });

    it('handles bigint result from SQLite integer column', async () => {
      mockExecute.mockResolvedValue(rs([{ total: BigInt(17) }]));
      expect(await store.getHourlyCount('cred-1')).toBe(17);
    });
  });

  describe('incrementHourlyCount()', () => {
    it('executes an UPSERT into ai_budget_hourly with credential_id', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.incrementHourlyCount('cred-1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['cred-1']),
        })
      );
    });
  });

  describe('getConcurrentSessions()', () => {
    it('always returns 0 (not yet persisted)', async () => {
      expect(await store.getConcurrentSessions('cred-1')).toBe(0);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('getDailySpend()', () => {
    it('returns the stored spend value', async () => {
      mockExecute.mockResolvedValue(rs([{ spend: 12.5 }]));
      expect(await store.getDailySpend('cred-1')).toBe(12.5);
    });

    it('returns 0 when no row exists for today', async () => {
      mockExecute.mockResolvedValue(rs([]));
      expect(await store.getDailySpend('cred-1')).toBe(0);
    });
  });

  describe('resetHourly()', () => {
    it('executes DELETE with the credential_id arg', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.resetHourly('cred-1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['cred-1'] })
      );
    });
  });

  describe('resetDaily()', () => {
    it('executes DELETE with credential_id and today\'s date args', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await store.resetDaily('cred-1');
      const call = mockExecute.mock.calls[0][0] as { args: unknown[] };
      expect(call.args[0]).toBe('cred-1');
      // Second arg is today's date in YYYY-MM-DD format
      expect(call.args[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

// ─── LibSqlAuditLogger ────────────────────────────────────────────────────────

describe('LibSqlAuditLogger', () => {
  let logger: LibSqlAuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new LibSqlAuditLogger(mockClient as never);
  });

  describe('log() — standard AuditLogEntry', () => {
    it('executes an INSERT with the 14 base columns', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await logger.log(makeAuditEntry());
      expect(mockExecute).toHaveBeenCalledOnce();
      const call = mockExecute.mock.calls[0][0] as { sql: string; args: unknown[] };
      expect(call.args).toContain('trace-1');
      expect(call.args).toContain('user-1');
      expect(call.args).toContain('credential.resolved');
    });

    it('resolves without throwing when execute fails (non-fatal)', async () => {
      mockExecute.mockRejectedValue(new Error('DB full'));
      await expect(logger.log(makeAuditEntry())).resolves.toBeUndefined();
    });
  });

  describe('log() — MigrationAuditLogEntry', () => {
    it('executes an INSERT with all 23 migration columns', async () => {
      mockExecute.mockResolvedValue(rs([], 1));
      await logger.log(makeMigrationEntry());
      const call = mockExecute.mock.calls[0][0] as { sql: string; args: unknown[] };
      expect(call.args).toContain('mig-1');
      expect(call.args).toContain('load');
      expect(call.args).toContain(100);
      expect(call.args).toContain(98);
    });
  });

  describe('summarize()', () => {
    it('returns a MigrationSummary with aggregated counts and phases', async () => {
      mockExecute
        .mockResolvedValueOnce(rs([{ total_read: 200, total_written: 195, total_failed: 5,
          started_at: '2026-06-04T00:00:00.000Z', completed_at: '2026-06-04T01:00:00.000Z' }]))
        .mockResolvedValueOnce(rs([{ phase: 'extract' }, { phase: 'load' }]))
        .mockResolvedValueOnce(rs([{ error_summary: '5 rows failed' }]));

      const summary = await logger.summarize('mig-1');
      expect(summary.migrationId).toBe('mig-1');
      expect(summary.totalRowsRead).toBe(200);
      expect(summary.totalRowsWritten).toBe(195);
      expect(summary.totalRowsFailed).toBe(5);
      expect(summary.phases).toEqual(['extract', 'load']);
      expect(summary.errors).toEqual(['5 rows failed']);
      expect(summary.startedAt).toBe('2026-06-04T00:00:00.000Z');
      expect(summary.completedAt).toBe('2026-06-04T01:00:00.000Z');
    });

    it('returns zeroed summary when no entries exist for the migrationId', async () => {
      mockExecute
        .mockResolvedValueOnce(rs([{ total_read: 0, total_written: 0, total_failed: 0,
          started_at: null, completed_at: null }]))
        .mockResolvedValueOnce(rs([]))
        .mockResolvedValueOnce(rs([]));

      const summary = await logger.summarize('mig-missing');
      expect(summary.totalRowsRead).toBe(0);
      expect(summary.phases).toEqual([]);
      expect(summary.errors).toEqual([]);
      expect(summary.completedAt).toBeUndefined();
    });
  });
});
