/**
 * GET  /api/budget       — returns per-credential hourly count, concurrent sessions, and daily spend
 * POST /api/budget/reset — reset hourly or daily counter for a credential
 *
 * Uses getServerBudgetStore() so results persist across restarts when
 * LIBSQL_URL is configured. Uses getServerStore() to derive the credential
 * list, replacing the hard-coded DEMO_CREDENTIALS from the previous version.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerBudgetStore, getServerStore } from '@/lib/server/credentialStore';

export async function GET() {
  const [budgetStore, credStore] = await Promise.all([
    getServerBudgetStore(),
    getServerStore(),
  ]);

  const credentials = await credStore.listActive();

  const results = await Promise.all(
    credentials.map(async (cred) => {
      const [hourlyCount, sessions, dailySpend] = await Promise.all([
        budgetStore.getHourlyCount(cred.id),
        budgetStore.getConcurrentSessions(cred.id),
        budgetStore.getDailySpend(cred.id),
      ]);
      return {
        credentialId: cred.id,
        name:         cred.name,
        usage: { hourlyCount, sessions, dailySpend },
      };
    })
  );

  return NextResponse.json({ credentials: results });
}

export async function POST(req: NextRequest) {
  const ResetSchema = z.object({
    credentialId: z.string().min(1),
    counter:      z.enum(['hourly', 'daily']),
  });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
  }

  const { credentialId, counter } = parsed.data;
  const budgetStore = await getServerBudgetStore();

  if (counter === 'hourly') { await budgetStore.resetHourly(credentialId); }
  else                      { await budgetStore.resetDaily(credentialId);  }

  return NextResponse.json({ ok: true, credentialId, counter, resetAt: new Date().toISOString() });
}
