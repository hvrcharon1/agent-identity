/**
 * LibSQL-backed BudgetStore.
 *
 * Persists budget counters (hourly resolution counts, daily spend) to SQLite.
 * Unlike MemoryBudgetStore, counters survive restarts and are shared across
 * multiple process instances when using a Turso remote URL.
 *
 * Hourly window: sliding 3600-second window using integer epoch ms buckets
 * rounded to the current hour. Stale buckets are pruned on resetHourly().
 */
import type { Client } from '@libsql/client';
import type { BudgetStore } from '@datacules/agent-identity';

const HOUR_MS = 3_600_000;

/** Round a timestamp down to its hour boundary (ms since epoch). */
function hourBucket(nowMs = Date.now()): number {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

/** Today's date as YYYY-MM-DD (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export class LibSqlBudgetStore implements BudgetStore {
  constructor(private readonly client: Client) {}

  /**
   * Sum of all resolution counts in the current and previous hour buckets
   * that fall within the last 3600 seconds.
   */
  async getHourlyCount(credentialId: string): Promise<number> {
    const windowStart = hourBucket() - HOUR_MS; // include up to 2 buckets
    const rs = await this.client.execute({
      sql: `SELECT COALESCE(SUM(count), 0) AS total
            FROM ai_budget_hourly
            WHERE credential_id = ? AND window_start >= ?`,
      args: [credentialId, windowStart],
    });
    return toNum((rs.rows[0] as Record<string, unknown>)?.['total']);
  }

  /**
   * Increment the counter for the current hour bucket.
   * Uses INSERT … ON CONFLICT to atomically increment.
   */
  async incrementHourlyCount(credentialId: string): Promise<void> {
    const bucket = hourBucket();
    await this.client.execute({
      sql: `INSERT INTO ai_budget_hourly (credential_id, window_start, count)
            VALUES (?, ?, 1)
            ON CONFLICT(credential_id, window_start)
            DO UPDATE SET count = count + 1`,
      args: [credentialId, bucket],
    });
  }

  /**
   * Concurrent sessions tracking is not yet persisted — returns 0.
   * A future update will add an ai_sessions table with TTL eviction.
   */
  async getConcurrentSessions(_credentialId: string): Promise<number> {
    return 0;
  }

  /** Total USD spend recorded for today (UTC). */
  async getDailySpend(credentialId: string): Promise<number> {
    const rs = await this.client.execute({
      sql: `SELECT COALESCE(spend_usd, 0) AS spend
            FROM ai_budget_daily
            WHERE credential_id = ? AND date = ?`,
      args: [credentialId, todayUtc()],
    });
    if (rs.rows.length === 0) return 0;
    return toNum((rs.rows[0] as Record<string, unknown>)?.['spend']);
  }

  /**
   * Record additional USD spend for today.
   * Not part of the BudgetStore interface — use this from your billing hooks.
   */
  async recordSpend(credentialId: string, amountUsd: number): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO ai_budget_daily (credential_id, date, spend_usd)
            VALUES (?, ?, ?)
            ON CONFLICT(credential_id, date)
            DO UPDATE SET spend_usd = spend_usd + excluded.spend_usd`,
      args: [credentialId, todayUtc(), amountUsd],
    });
  }

  /** Delete all hourly bucket rows for this credential. */
  async resetHourly(credentialId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM ai_budget_hourly WHERE credential_id = ?`,
      args: [credentialId],
    });
  }

  /** Delete today's spend row for this credential. */
  async resetDaily(credentialId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM ai_budget_daily WHERE credential_id = ? AND date = ?`,
      args: [credentialId, todayUtc()],
    });
  }
}
