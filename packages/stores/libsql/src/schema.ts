/**
 * LibSQL schema bootstrap and store factory.
 *
 * All six tables share a single @libsql/client connection and are created
 * with IF NOT EXISTS — safe to call on every startup.
 */
import type { Client } from '@libsql/client';
import { LibSqlCredentialStore } from './LibSqlCredentialStore.js';
import { LibSqlApprovalStore } from './LibSqlApprovalStore.js';
import { LibSqlBudgetStore } from './LibSqlBudgetStore.js';
import { LibSqlAuditLogger } from './LibSqlAuditLogger.js';

// ─── DDL ─────────────────────────────────────────────────────────────────────

/** All CREATE TABLE / CREATE INDEX statements. Safe to run multiple times. */
export const SCHEMA_DDL: readonly string[] = [
  // ── Credentials ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_credentials (
    id                     TEXT PRIMARY KEY,
    kind                   TEXT NOT NULL,
    name                   TEXT NOT NULL,
    scope                  TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    provider               TEXT,
    ref                    TEXT NOT NULL,
    expires_at             TEXT,
    last_rotated           TEXT,
    refresh_token_ref      TEXT,
    rotation_interval_days INTEGER,
    rotation_policy        TEXT,
    budget_policy          TEXT,
    tags                   TEXT,
    pre_claim_scopes       TEXT,
    post_claim_scopes      TEXT,
    claimed_at             TEXT,
    identity_issuer        TEXT,
    identity_subject       TEXT,
    identity_audience      TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cred_ref    ON ai_credentials(ref)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_status ON ai_credentials(status)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_kind   ON ai_credentials(kind, status)`,

  // ── Migration reservation locks ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_reservations (
    ref          TEXT    NOT NULL PRIMARY KEY,
    migration_id TEXT    NOT NULL,
    expires_at   INTEGER NOT NULL
  )`,

  // ── Approval requests ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_approval_requests (
    request_id    TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL,
    rule_id       TEXT NOT NULL,
    context       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TEXT NOT NULL,
    resolved_at   TEXT,
    resolved_by   TEXT,
    justification TEXT,
    expires_at    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_approval_status ON ai_approval_requests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_cred   ON ai_approval_requests(credential_id)`,

  // ── Budget — hourly sliding-window counters ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_budget_hourly (
    credential_id TEXT    NOT NULL,
    window_start  INTEGER NOT NULL,
    count         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (credential_id, window_start)
  )`,

  // ── Budget — daily spend ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_budget_daily (
    credential_id TEXT NOT NULL,
    date          TEXT NOT NULL,
    spend_usd     REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (credential_id, date)
  )`,

  // ── Audit log ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_audit_log (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp            TEXT    NOT NULL,
    trace_id             TEXT    NOT NULL,
    user_id              TEXT    NOT NULL,
    action               TEXT    NOT NULL,
    resource_id          TEXT    NOT NULL,
    resource_kind        TEXT    NOT NULL,
    provider             TEXT    NOT NULL,
    model                TEXT    NOT NULL,
    credential_id        TEXT    NOT NULL,
    credential_kind      TEXT    NOT NULL,
    resolved_for         TEXT    NOT NULL,
    is_canary            INTEGER NOT NULL DEFAULT 0,
    identity_chain       TEXT,
    spiffe_id            TEXT,
    migration_id         TEXT,
    phase                TEXT,
    rows_read            INTEGER,
    rows_written         INTEGER,
    rows_failed          INTEGER,
    dry_run              INTEGER,
    source_credential_id TEXT,
    target_credential_id TEXT,
    error_summary        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_trace     ON ai_audit_log(trace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action    ON ai_audit_log(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_migration ON ai_audit_log(migration_id)`,
];

/**
 * Bootstrap all agent-identity tables and indexes.
 * Safe to call on every startup — all statements use IF NOT EXISTS.
 */
export async function bootstrapSchema(client: Client): Promise<void> {
  for (const ddl of SCHEMA_DDL) {
    await client.execute(ddl);
  }
}

// ─── Store Factory ────────────────────────────────────────────────────────────

export interface LibSqlStoreOptions {
  /**
   * LibSQL connection URL.
   *
   * Embedded (zero infra):  `'file:./agent-identity.db'`  or  `':memory:'`
   * Distributed (Turso):    `'libsql://your-db.turso.io'`
   * HTTPS (Turso / local):  `'https://your-db.turso.io'`
   */
  url: string;
  /** Auth token for Turso remote connections. Not required for local files. */
  authToken?: string;
}

export interface LibSqlStores {
  /** The raw @libsql/client connection — use for custom queries. */
  client: Client;
  /** Implements CredentialStore — pass to createRouterFromStore(). */
  credentialStore: LibSqlCredentialStore;
  /** Implements ApprovalStore — pass to ApprovalManager(). */
  approvalStore: LibSqlApprovalStore;
  /** Implements BudgetStore — pass to BudgetEnforcer(). */
  budgetStore: LibSqlBudgetStore;
  /** Implements MigrationAuditLogger — pass to CredentialRouter or MigrationAuditLogger consumers. */
  auditLogger: LibSqlAuditLogger;
}

/**
 * Create all four agent-identity stores backed by a single LibSQL connection.
 * Schema is bootstrapped automatically — no migration tool required.
 *
 * @example
 * // Embedded — zero infrastructure
 * const stores = await createLibSqlStores({ url: 'file:./agent-identity.db' });
 * const router = createRouterFromStore(stores.credentialStore, rules, stores.auditLogger);
 *
 * @example
 * // Distributed — Turso (same API, one URL swap)
 * const stores = await createLibSqlStores({
 *   url: process.env.TURSO_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 */
export async function createLibSqlStores(options: LibSqlStoreOptions): Promise<LibSqlStores> {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: options.url, authToken: options.authToken });
  await bootstrapSchema(client);
  return {
    client,
    credentialStore: new LibSqlCredentialStore(client),
    approvalStore:   new LibSqlApprovalStore(client),
    budgetStore:     new LibSqlBudgetStore(client),
    auditLogger:     new LibSqlAuditLogger(client),
  };
}
