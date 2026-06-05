/**
 * GET /api/budget/:credentialId/history
 *
 * Returns time-series usage data for a single credential, suitable for
 * charting in the BudgetTab. Supports two time-series:
 *
 *   hourly — last N hours of resolution counts (from ai_budget_hourly when
 *            LIBSQL_URL is configured; empty array for MemoryBudgetStore)
 *   daily  — last N days of USD spend (from ai_budget_daily; same caveat)
 *
 * Query parameters:
 *   hours  (number, 1–168, default 24)  — how many hourly buckets to return
 *   days   (number, 1–90,  default 7)   — how many daily spend rows to return
 *
 * Response:
 *   200 {
 *     credentialId: string,
 *     hourly: { hour: string (ISO 8601 UTC), count: number }[],
 *     daily:  { date: string (YYYY-MM-DD), spendUsd: number }[],
 *   }
 *   400  { error: string }  — invalid credentialId
 *   404  { error: string }  — credential not found in active store
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerBudgetStore, getServerStore } from '@/lib/server/credentialStore';
import type { LibSqlBudgetStore } from '@datacules/agent-identity-store-libsql';

/** How many ms in one hour. */
const HOUR_MS = 3_600_000;

/** Check if a value is a LibSqlBudgetStore (duck-type: has listHourlyBuckets). */
function isLibSql(store: unknown): store is LibSqlBudgetStore {
  return typeof (store as Record<string, unknown>).listHourlyBuckets === 'function';
}

export async function GET(
  req: NextRequest,
  { params }: { params: { credentialId: string } }
) {
  const { credentialId } = params;

  if (!credentialId || credentialId.trim() === '') {
    return NextResponse.json({ error: 'credentialId path parameter is required' }, { status: 400 });
  }

  // Parse optional query params
  const sp    = req.nextUrl.searchParams;
  const hours = Math.min(168, Math.max(1, parseInt(sp.get('hours') ?? '24', 10) || 24));
  const days  = Math.min(90,  Math.max(1, parseInt(sp.get('days')  ?? '7',  10) || 7));

  // Verify the credential exists
  const credStore = await getServerStore();
  const active    = await credStore.listActive();
  const found     = active.find((c) => c.id === credentialId.trim());
  if (!found) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
  }

  const budgetStore = await getServerBudgetStore();

  // ── Hourly history ────────────────────────────────────────────────────────
  let hourlyHistory: { hour: string; count: number }[] = [];

  if (isLibSql(budgetStore)) {
    const sinceMs  = Date.now() - hours * HOUR_MS;
    const buckets  = await budgetStore.listHourlyBuckets(credentialId.trim(), sinceMs);
    hourlyHistory  = buckets.map((b) => ({
      hour:  new Date(b.windowStart).toISOString(),
      count: b.count,
    }));
  }
  // MemoryBudgetStore has no history — hourlyHistory stays empty []

  // ── Daily spend history ───────────────────────────────────────────────────
  let dailyHistory: { date: string; spendUsd: number }[] = [];

  if (isLibSql(budgetStore)) {
    const rows   = await budgetStore.listDailySpend(credentialId.trim(), days);
    dailyHistory = rows.map((r) => ({ date: r.date, spendUsd: r.spendUsd }));
  }

  return NextResponse.json({
    credentialId: credentialId.trim(),
    hourly: hourlyHistory,
    daily:  dailyHistory,
  });
}
