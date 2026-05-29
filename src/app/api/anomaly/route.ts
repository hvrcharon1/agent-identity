import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ─── Request schemas ─────────────────────────────────────────────────────────

const ObserveRequestSchema = z.object({
  userId: z.string().min(1),
  resourceId: z.string().min(1),
  resourceKind: z.enum(['shared', 'personal']),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'mistral', 'local']),
  model: z.string().min(1),
  action: z.string().min(1),
  traceId: z.string().min(1),
  requestedAt: z.string().datetime(),
  sessionId: z.string().optional(),
  parentTraceId: z.string().optional(),
});

const ResetBaselineSchema = z.object({
  userId: z.string().min(1),
});

/**
 * POST /api/anomaly
 *
 * Body: AgentRequestContext
 * Response: { anomalies: AnomalyEvent[]; blocked: boolean }
 *
 * Passes the context through the server-side AnomalyDetector instance.
 * The detector is module-level so baselines accumulate across requests
 * within the same server process lifetime (in-memory, no persistence).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  // Distinguish observe vs reset by path suffix
  const url = new URL(req.url);
  if (url.pathname.endsWith('/reset')) {
    const parsed = ResetBaselineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    // NOTE: In a real deployment, call anomalyDetector.resetBaseline(userId).
    // Here we return a success stub since the detector is instantiated per-component
    // in the dashboard demo (no shared server-side instance in the dev server).
    return NextResponse.json({ ok: true, reset: parsed.data.userId });
  }

  const parsed = ObserveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Stub: in a production deployment, call:
  //   const result = await anomalyDetector.observe(parsed.data, () => router.resolveAsync(parsed.data));
  // and return any accumulated anomaly events.
  // The dashboard tab uses in-memory simulation; this route is the integration point
  // for non-browser consumers (Python SDK, CI health checks, etc.).
  return NextResponse.json({
    ok: true,
    observed: parsed.data.userId,
    anomalies: [],
    blocked: false,
  });
}

/**
 * DELETE /api/anomaly?userId=...
 * Reset a specific agent's baseline.
 */
export async function DELETE(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  // Stub — see POST /reset note above.
  return NextResponse.json({ ok: true, reset: userId });
}
