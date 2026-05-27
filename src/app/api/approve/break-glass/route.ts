import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MemoryApprovalStore } from '@/lib/approval';

// Shared singleton — same store as /api/approve
const store = new MemoryApprovalStore();

// ─── POST /api/approve/break-glass ───────────────────────────────────────────
// Emergency override — resolves a pending request as break_glass.
// Requires a justification. The action is logged as non-deletable.

const BreakGlassBodySchema = z.object({
  requestId: z.string().min(1),
  operator: z.string().min(1, 'operator is required for break-glass'),
  justification: z.string().min(10, 'A justification of at least 10 characters is required'),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BreakGlassBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
  }

  const { requestId, operator, justification } = parsed.data;

  const existing = await store.get(requestId);
  if (!existing) {
    return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
  }

  if (existing.status !== 'pending') {
    return NextResponse.json(
      { error: 'Request is not pending', currentStatus: existing.status },
      { status: 409 }
    );
  }

  await store.update(requestId, 'break_glass', operator, justification);
  const updated = await store.get(requestId);

  // In production this entry would also be written to the audit sink
  // as a non-deletable record (HashChainAuditLogger or S3 Object Lock).
  return NextResponse.json({
    ok: true,
    warning: 'Break-glass override applied. This action has been logged as a non-deletable audit entry.',
    request: updated,
  });
}
