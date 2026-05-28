import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * /api/anomaly — Anomaly detector state endpoints.
 *
 * These endpoints are for dashboard inspection and operational tooling.
 * The actual AnomalyDetector instance lives in the application layer,
 * wrapping router.resolveAsync() calls — not in the HTTP request pipeline.
 *
 * In production, wire a shared AnomalyDetector singleton into your
 * route handlers and export getDetectorState() / resetBaseline() from
 * a shared module (e.g. src/lib/anomaly.ts).
 *
 * The mock responses below match the AnomalyDetector public API shape
 * so the dashboard can be tested without a live detector instance.
 */

const ResetSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

/** GET /api/anomaly — return current detector state */
export async function GET() {
  // In production: return getDetectorState() from src/lib/anomaly.ts
  return NextResponse.json({
    baselines: [
      {
        userId: 'user-alice',
        sampleCount: 42,
        knownActions: ['read', 'summarise'],
        knownResourceKinds: ['document', 'email'],
        knownProviders: ['openai'],
        ewmaRatePerHour: 12.4,
      },
      {
        userId: 'user-bob',
        sampleCount: 28,
        knownActions: ['read', 'write', 'classify'],
        knownResourceKinds: ['code', 'pr'],
        knownProviders: ['anthropic', 'openai'],
        ewmaRatePerHour: 5.8,
      },
    ],
    recentEvents: [],
    policy: {
      lowAction: 'warn',
      mediumAction: 'warn',
      highAction: 'warn',
      baselineSamples: 20,
      rateSpikeThreshold: 3.0,
    },
  });
}

/** POST /api/anomaly/reset — reset a specific agent baseline */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { userId } = parsed.data;

  // In production: call detector.resetBaseline(userId) on the shared singleton
  return NextResponse.json({
    ok: true,
    userId,
    message: `Baseline reset for ${userId}. Anomaly scoring will resume after ${20} samples.`,
  });
}
