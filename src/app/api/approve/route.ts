import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MemoryApprovalStore, ApprovalManager } from '@/lib/approval';

// Singleton store — shared across requests within the process
const store = new MemoryApprovalStore();
const manager = new ApprovalManager(store);

// ─── POST /api/approve ────────────────────────────────────────────────────────
// Approve or reject a pending approval request.

const ApproveBodySchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
  resolvedBy: z.string().optional(),
  justification: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ApproveBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
  }

  const { requestId, action, resolvedBy, justification } = parsed.data;

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

  const status = action === 'approve' ? 'approved' : 'rejected';
  await store.update(requestId, status, resolvedBy ?? 'api-caller', justification);

  const updated = await store.get(requestId);
  return NextResponse.json({ ok: true, request: updated });
}
