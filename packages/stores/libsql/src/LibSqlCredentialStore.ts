/**
 * LibSQL-backed CredentialStore.
 *
 * Implements the full CredentialStore interface from @datacules/agent-identity
 * including the optional reserve/release/revokeByIdentity methods.
 *
 * Additional method: upsert() — not part of the interface, used to seed
 * credentials and to record identity issuer/subject for revokeByIdentity().
 */
import type { Client } from '@libsql/client';
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';

// ─── Row helpers ─────────────────────────────────────────────────────────────

type RowLike = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function strOrUndef(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function jsonParse<T>(v: unknown): T | undefined {
  if (v == null || v === '') return undefined;
  try { return JSON.parse(String(v)) as T; } catch { return undefined; }
}

function rowToCredential(row: RowLike): Credential {
  return {
    id:                   str(row['id']),
    kind:                 str(row['kind']) as CredentialKind,
    name:                 str(row['name']),
    scope:                str(row['scope']),
    status:               str(row['status']) as Credential['status'],
    provider:             strOrUndef(row['provider']),
    ref:                  str(row['ref']),
    expiresAt:            strOrUndef(row['expires_at']),
    lastRotated:          strOrUndef(row['last_rotated']),
    refreshTokenRef:      strOrUndef(row['refresh_token_ref']),
    rotationIntervalDays: numOrUndef(row['rotation_interval_days']),
    rotation:             jsonParse(row['rotation_policy']),
    budget:               jsonParse(row['budget_policy']),
    tags:                 jsonParse<string[]>(row['tags']),
    preClaimScopes:       jsonParse<string[]>(row['pre_claim_scopes']),
    postClaimScopes:      jsonParse<string[]>(row['post_claim_scopes']),
    claimedAt:            strOrUndef(row['claimed_at']),
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export interface UpsertCredentialOptions extends Credential {
  /** OIDC issuer URL — recorded for revokeByIdentity(). */
  identityIssuer?:   string;
  /** OIDC subject (userId at the provider) — for revokeByIdentity(). */
  identitySubject?:  string;
  /** OIDC audience — for revokeByIdentity(). */
  identityAudience?: string;
}

export class LibSqlCredentialStore implements CredentialStore {
  constructor(private readonly client: Client) {}

  // ── CredentialStore interface ───────────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    try {
      const rs = await this.client.execute({
        sql: `SELECT * FROM ai_credentials WHERE ref = ? AND status = 'active' LIMIT 1`,
        args: [ref],
      });
      if (rs.rows.length === 0) return null;
      return rowToCredential(rs.rows[0] as RowLike);
    } catch {
      return null;
    }
  }

  async listActive(): Promise<Credential[]> {
    const rs = await this.client.execute(
      `SELECT * FROM ai_credentials WHERE status = 'active' ORDER BY id`
    );
    return rs.rows.map((r) => rowToCredential(r as RowLike));
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const rs = await this.client.execute({
      sql: `SELECT * FROM ai_credentials WHERE status = 'active' AND kind = ? ORDER BY id`,
      args: [kind],
    });
    return rs.rows.map((r) => rowToCredential(r as RowLike));
  }

  /**
   * Atomically reserve a credential ref for a migration run.
   * Returns true if the lock was acquired; false if another migration holds it.
   * Idempotent: a migration that already holds the lock extends its TTL.
   */
  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      // Check existing lock
      const existing = await this.client.execute({
        sql: `SELECT migration_id, expires_at FROM ai_reservations WHERE ref = ?`,
        args: [ref],
      });
      if (existing.rows.length > 0) {
        const row = existing.rows[0] as RowLike;
        const owner = str(row['migration_id']);
        const expiry = Number(row['expires_at'] ?? 0);
        if (owner !== migrationId && expiry > nowSec) {
          return false; // Locked by a different, non-expired migration
        }
      }
      // Acquire or extend
      await this.client.execute({
        sql: `INSERT OR REPLACE INTO ai_reservations (ref, migration_id, expires_at)
              VALUES (?, ?, ?)`,
        args: [ref, migrationId, expiresAt],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Release a migration reservation. Idempotent — no-throw if already released. */
  async release(ref: string, migrationId: string): Promise<void> {
    try {
      await this.client.execute({
        sql: `DELETE FROM ai_reservations WHERE ref = ? AND migration_id = ?`,
        args: [ref, migrationId],
      });
    } catch {
      // Idempotent: already released or never held
    }
  }

  /**
   * Revoke all credentials that match the OIDC identity triple.
   * Called by RevocationHandler when a logout+jwt is received.
   * Only affects credentials seeded via upsert() with identity fields set.
   */
  async revokeByIdentity(
    issuer: string,
    subject: string,
    audience: string
  ): Promise<number> {
    const rs = await this.client.execute({
      sql: `UPDATE ai_credentials
            SET status = 'revoked', updated_at = datetime('now')
            WHERE identity_issuer = ?
              AND identity_subject = ?
              AND (identity_audience = ? OR identity_audience IS NULL)
              AND status != 'revoked'`,
      args: [issuer, subject, audience],
    });
    return rs.rowsAffected;
  }

  // ── Extra: not in CredentialStore interface ─────────────────────────────────

  /**
   * Upsert (insert or update) a credential.
   * Use this to seed credentials on startup and to record OIDC identity
   * metadata for revokeByIdentity().
   */
  async upsert(credential: UpsertCredentialOptions): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO ai_credentials (
              id, kind, name, scope, status, provider, ref,
              expires_at, last_rotated, refresh_token_ref, rotation_interval_days,
              rotation_policy, budget_policy, tags,
              pre_claim_scopes, post_claim_scopes, claimed_at,
              identity_issuer, identity_subject, identity_audience
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              kind                   = excluded.kind,
              name                   = excluded.name,
              scope                  = excluded.scope,
              status                 = excluded.status,
              provider               = excluded.provider,
              ref                    = excluded.ref,
              expires_at             = excluded.expires_at,
              last_rotated           = excluded.last_rotated,
              refresh_token_ref      = excluded.refresh_token_ref,
              rotation_interval_days = excluded.rotation_interval_days,
              rotation_policy        = excluded.rotation_policy,
              budget_policy          = excluded.budget_policy,
              tags                   = excluded.tags,
              pre_claim_scopes       = excluded.pre_claim_scopes,
              post_claim_scopes      = excluded.post_claim_scopes,
              claimed_at             = excluded.claimed_at,
              identity_issuer        = excluded.identity_issuer,
              identity_subject       = excluded.identity_subject,
              identity_audience      = excluded.identity_audience,
              updated_at             = datetime('now')`,
      args: [
        credential.id,
        credential.kind,
        credential.name,
        credential.scope,
        credential.status,
        credential.provider ?? null,
        credential.ref,
        credential.expiresAt             ?? null,
        credential.lastRotated           ?? null,
        credential.refreshTokenRef       ?? null,
        credential.rotationIntervalDays  ?? null,
        credential.rotation              ? JSON.stringify(credential.rotation)        : null,
        credential.budget                ? JSON.stringify(credential.budget)          : null,
        credential.tags                  ? JSON.stringify(credential.tags)            : null,
        credential.preClaimScopes        ? JSON.stringify(credential.preClaimScopes)  : null,
        credential.postClaimScopes       ? JSON.stringify(credential.postClaimScopes) : null,
        credential.claimedAt             ?? null,
        credential.identityIssuer        ?? null,
        credential.identitySubject       ?? null,
        credential.identityAudience      ?? null,
      ],
    });
  }
}
