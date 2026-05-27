import { NextResponse } from 'next/server';
import { HmacAttestationSigner, buildAttestation } from '@datacules/agent-identity';
import type { AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

// ─── POST /api/attest/sign — sign a demo attestation token ───────────────────
// This endpoint is for the dashboard demo only.
// In production, attestation signing happens inside router.resolveAsync().

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      secret?: string;
      userId?: string;
      credentialId?: string;
      action?: string;
      resourceId?: string;
      traceId?: string;
      ttlSeconds?: number;
    };

    const { secret, userId, credentialId, action, resourceId, traceId, ttlSeconds } = body;

    if (!secret) return NextResponse.json({ error: 'secret is required' }, { status: 400 });
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!credentialId) return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });

    const signer = new HmacAttestationSigner({ secret, ttlSeconds: ttlSeconds ?? 300 });

    const ctx: AgentRequestContext = {
      userId: userId,
      resourceId: resourceId ?? 'unknown-resource',
      resourceKind: 'personal',
      provider: 'local',
      model: 'demo',
      action: action ?? 'read',
      traceId: traceId ?? `trace-${Date.now()}`,
      requestedAt: new Date().toISOString(),
    };

    const resolved: ResolvedCredential = {
      credentialId: credentialId,
      kind: 'fixed',
      ref: 'demo-ref',
      resolvedFor: userId,
    };

    const token = await buildAttestation(ctx, resolved, {
      signer,
      issuer: 'agent-identity:demo',
      ttlSeconds: ttlSeconds ?? 300,
    });

    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
