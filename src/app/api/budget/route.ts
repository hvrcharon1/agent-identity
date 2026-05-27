import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MemoryBudgetStore, BudgetEnforcer } from '@/lib/budget';
import type { Credential } from '@/lib/types';

const budgetStore = new MemoryBudgetStore();
const enforcer = new BudgetEnforcer(budgetStore);

// Stub credentials with budget policies for the API demo
const DEMO_CREDENTIALS: Credential[] = [
  {
    id: 'cred-openai-prod', kind: 'fixed', name: 'OpenAI production',
    scope: 'read write', status: 'active', ref: 'openai-prod-slot',
    budget: { maxResolutionsPerHour: 1000, maxConcurrentSessions: 50, softThresholdPercent: 80 },
  },
  {
    id: 'cred-anthropic-prod', kind: 'fixed', name: 'Anthropic production',
    scope: 'read write', status: 'active', ref: 'anthropic-prod-slot',
    budget: { maxResolutionsPerHour: 500, maxConcurrentSessions: 25, softThresholdPercent: 80 },
  },
];

// ─── GET /api/budget ──────────────────────────────────────────────────────────
// Returns current utilisation for all budget-enabled credentials.

export async function GET() {
  const results = await Promise.all(
    DEMO_CREDENTIALS.map(async (cred) => {
      const hourlyCount = await budgetStore.getHourlyCount(cred.id);
      const sessions    = await budgetStore.getConcurrentSessions(cred.id);
      const dailySpend  = await budgetStore.getDailySpend(cred.id);
      return {
        credentialId: cred.id,
        name: cred.name,
        policy: cred.budget,
        usage: { hourlyCount, sessions, dailySpend },
      };
    })
  );
  return NextResponse.json({ credentials: results });
}

// ─── POST /api/budget/reset ───────────────────────────────────────────────────
// Reset hourly or daily counter for a credential.

export async function POST(req: NextRequest) {
  const ResetSchema = z.object({
    credentialId: z.string().min(1),
    counter: z.enum(['hourly', 'daily']),
  });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
  }

  const { credentialId, counter } = parsed.data;

  if (counter === 'hourly') {
    await budgetStore.resetHourly(credentialId);
  } else {
    await budgetStore.resetDaily(credentialId);
  }

  return NextResponse.json({ ok: true, credentialId, counter, resetAt: new Date().toISOString() });
}
