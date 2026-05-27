import { NextResponse } from 'next/server';
import { HmacAttestationSigner, buildAttestation, verifyAttestation } from '@datacules/agent-identity';
import type { AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

// ─── POST /api/attest — verify an attestation token ──────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; secret?: string };
    const { token, secret } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }
    if (!secret || typeof secret !== 'string') {
      return NextResponse.json({ error: 'secret is required' }, { status: 400 });
    }

    const signer = new HmacAttestationSigner({ secret });
    const payload = await verifyAttestation(token, signer);

    if (!payload) {
      // Decode without verifying to show payload even on failure
      const parts = token.split('.');
      let decodedPayload = null;
      if (parts.length === 3 && parts[1]) {
        try {
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          decodedPayload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        } catch { /* ignore */ }
      }
      const now = Math.floor(Date.now() / 1000);
      const expired = decodedPayload?.exp ? decodedPayload.exp < now : false;
      return NextResponse.json({
        valid: false,
        expired,
        payload: decodedPayload,
        error: expired ? 'Token has expired' : 'Signature verification failed',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    return NextResponse.json({
      valid: true,
      expired: false,
      payload,
      remainingSeconds: typeof payload.exp === 'number' ? payload.exp - now : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
