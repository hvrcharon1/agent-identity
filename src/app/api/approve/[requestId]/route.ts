/**
 * GET /api/approve/:requestId
 *
 * Poll the status of a single approval request from the persistent store.
 * Used by:
 *   - ApprovalTab.tsx for live status polling (replaces client-side optimistic state)
 *   - Webhook consumers that need to verify an approval before proceeding
 *   - CLI tooling (future agent-identity-cli approve status <id>)
 *
 * Returns:
 *   200  { request: ApprovalRequest }  — request found
 *   404  { error: string }             — no request with this ID
 */
import { NextResponse } from 'next/server';
import { getServerApprovalStore } from '@/lib/server/credentialStore';

export async function GET(
  _req: Request,
  { params }: { params: { requestId: string } }
) {
  const { requestId } = params;

  if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
    return NextResponse.json({ error: 'requestId path parameter is required' }, { status: 400 });
  }

  const store = await getServerApprovalStore();
  const request = await store.get(requestId.trim());

  if (!request) {
    return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
  }

  return NextResponse.json({ request });
}
