/**
 * LibSQL-backed MigrationAuditLogger.
 *
 * Persists audit log entries (both standard AuditLogEntry and
 * MigrationAuditLogEntry) to the ai_audit_log table. Provides
 * summarize() for per-migration reporting and compliance exports.
 *
 * The hash-chain tamper-evident guarantee lives in
 * @datacules/agent-identity-audit (HashChainAuditLogger). Use
 * CompositeAuditLogger to combine both: chain integrity + durable storage.
 */
import type { Client } from '@libsql/client';
import type {
  AuditLogEntry,
  MigrationAuditLogEntry,
  MigrationAuditLogger,
  MigrationSummary,
  MigrationPhase,
} from '@datacules/agent-identity';

function isMigration(entry: AuditLogEntry): entry is MigrationAuditLogEntry {
  return 'migrationId' in entry;
}

export class LibSqlAuditLogger implements MigrationAuditLogger {
  constructor(private readonly client: Client) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      if (isMigration(entry)) {
        await this.client.execute({
          sql: `INSERT INTO ai_audit_log (
                  timestamp, trace_id, user_id, action, resource_id,
                  resource_kind, provider, model, credential_id, credential_kind,
                  resolved_for, is_canary, identity_chain, spiffe_id,
                  migration_id, phase, rows_read, rows_written, rows_failed,
                  dry_run, source_credential_id, target_credential_id, error_summary
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            entry.timestamp,
            entry.traceId,
            entry.userId,
            entry.action,
            entry.resourceId,
            entry.resourceKind,
            entry.provider,
            entry.model,
            entry.credentialId,
            entry.credentialKind,
            entry.resolvedFor,
            entry.isCanary ? 1 : 0,
            entry.identityChain ? JSON.stringify(entry.identityChain) : null,
            entry.spiffeId ?? null,
            entry.migrationId,
            entry.phase,
            entry.rowsRead    ?? null,
            entry.rowsWritten ?? null,
            entry.rowsFailed  ?? null,
            entry.dryRun ? 1 : 0,
            entry.sourceCredentialId,
            entry.targetCredentialId,
            entry.errorSummary ?? null,
          ],
        });
      } else {
        await this.client.execute({
          sql: `INSERT INTO ai_audit_log (
                  timestamp, trace_id, user_id, action, resource_id,
                  resource_kind, provider, model, credential_id, credential_kind,
                  resolved_for, is_canary, identity_chain, spiffe_id
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            entry.timestamp,
            entry.traceId,
            entry.userId,
            entry.action,
            entry.resourceId,
            entry.resourceKind,
            entry.provider,
            entry.model,
            entry.credentialId,
            entry.credentialKind,
            entry.resolvedFor,
            entry.isCanary ? 1 : 0,
            entry.identityChain ? JSON.stringify(entry.identityChain) : null,
            entry.spiffeId ?? null,
          ],
        });
      }
    } catch {
      // Audit failures must never break the credential resolution path
    }
  }

  /**
   * Aggregate all audit entries for a migration run into a MigrationSummary.
   * Returns a summary with zero counts and empty arrays if no entries found.
   */
  async summarize(migrationId: string): Promise<MigrationSummary> {
    // Aggregate counts
    const statsRs = await this.client.execute({
      sql: `SELECT
              COALESCE(SUM(rows_read),    0) AS total_read,
              COALESCE(SUM(rows_written), 0) AS total_written,
              COALESCE(SUM(rows_failed),  0) AS total_failed,
              MIN(timestamp)                  AS started_at,
              MAX(timestamp)                  AS completed_at
            FROM ai_audit_log
            WHERE migration_id = ?`,
      args: [migrationId],
    });

    // Distinct phases (preserving order of first appearance)
    const phaseRs = await this.client.execute({
      sql: `SELECT DISTINCT phase
            FROM ai_audit_log
            WHERE migration_id = ? AND phase IS NOT NULL
            ORDER BY id ASC`,
      args: [migrationId],
    });

    // Error summaries
    const errRs = await this.client.execute({
      sql: `SELECT error_summary
            FROM ai_audit_log
            WHERE migration_id = ? AND error_summary IS NOT NULL
            ORDER BY id ASC`,
      args: [migrationId],
    });

    const statsRow = statsRs.rows[0] as Record<string, unknown>;
    const toNum = (v: unknown): number => {
      if (v == null) return 0;
      if (typeof v === 'bigint') return Number(v);
      return Number(v) || 0;
    };

    const phases = phaseRs.rows.map(
      (r) => String((r as Record<string, unknown>)['phase']) as MigrationPhase
    );

    const errors = errRs.rows.map(
      (r) => String((r as Record<string, unknown>)['error_summary'])
    );

    const startedAt   = statsRow?.['started_at']   ? String(statsRow['started_at'])   : new Date().toISOString();
    const completedAt = statsRow?.['completed_at'] ? String(statsRow['completed_at']) : undefined;

    return {
      migrationId,
      phases,
      totalRowsRead:    toNum(statsRow?.['total_read']),
      totalRowsWritten: toNum(statsRow?.['total_written']),
      totalRowsFailed:  toNum(statsRow?.['total_failed']),
      startedAt,
      completedAt,
      errors,
    };
  }
}
