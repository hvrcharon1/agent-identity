/**
 * LibSQL-backed ApprovalStore.
 *
 * Persists approval requests across restarts — unlike MemoryApprovalStore,
 * pending requests survive process crashes and horizontal scaling.
 */
import type { Client } from '@libsql/client';
import type { ApprovalRequest, ApprovalStatus, AgentRequestContext } from '@datacules/agent-identity';
import type { ApprovalStore } from '@datacules/agent-identity';

type RowLike = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function strOrUndef(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

function rowToRequest(row: RowLike): ApprovalRequest {
  return {
    requestId:    str(row['request_id']),
    credentialId: str(row['credential_id']),
    ruleId:       str(row['rule_id']),
    context:      JSON.parse(str(row['context'])) as AgentRequestContext,
    status:       str(row['status']) as ApprovalStatus,
    requestedAt:  str(row['requested_at']),
    resolvedAt:   strOrUndef(row['resolved_at']),
    resolvedBy:   strOrUndef(row['resolved_by']),
    justification: strOrUndef(row['justification']),
    expiresAt:    str(row['expires_at']),
  };
}

export class LibSqlApprovalStore implements ApprovalStore {
  constructor(private readonly client: Client) {}

  async create(request: ApprovalRequest): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO ai_approval_requests
              (request_id, credential_id, rule_id, context, status,
               requested_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        request.requestId,
        request.credentialId,
        request.ruleId,
        JSON.stringify(request.context),
        request.status,
        request.requestedAt,
        request.expiresAt,
      ],
    });
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    const rs = await this.client.execute({
      sql: `SELECT * FROM ai_approval_requests WHERE request_id = ? LIMIT 1`,
      args: [requestId],
    });
    if (rs.rows.length === 0) return null;
    return rowToRequest(rs.rows[0] as RowLike);
  }

  async update(
    requestId: string,
    status: ApprovalStatus,
    resolvedBy?: string,
    justification?: string
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE ai_approval_requests
            SET status        = ?,
                resolved_at   = datetime('now'),
                resolved_by   = ?,
                justification = ?
            WHERE request_id  = ?`,
      args: [status, resolvedBy ?? null, justification ?? null, requestId],
    });
  }

  async listPending(): Promise<ApprovalRequest[]> {
    const rs = await this.client.execute(
      `SELECT * FROM ai_approval_requests
       WHERE status = 'pending'
       ORDER BY requested_at ASC`
    );
    return rs.rows.map((r) => rowToRequest(r as RowLike));
  }
}
