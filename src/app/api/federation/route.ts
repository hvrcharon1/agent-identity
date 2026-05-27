import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FederationIssuer, FederationVerifier } from '@/lib/federation';
import type { FederationConfig } from '@/lib/types';

// Demo federation config
const FEDERATION_CONFIG: FederationConfig = {
  trustDomain: 'acme.com',
  trustedDomains: {
    'acme.com':   'MCowBQYDK2VwAyEA...acme',
    'vendor.com': 'MCowBQYDK2VwAyEA...vendor',
    'audit.io':   'MCowBQYDK2VwAyEA...audit',
  },
};

const issuer   = new FederationIssuer(FEDERATION_CONFIG.trustDomain, 'api-agent');
const verifier = new FederationVerifier(FEDERATION_CONFIG);

// ─── POST /api/federation/issue ──────────────────────────────────────────────
// Issue a new identity chain from an AgentRequestContext.

const IssueSchema = z.object({
  userId:     z.string().min(1),
  resourceId: z.string().min(1),
  action:     z.string().min(1),
  traceId:    z.string().min(1),
  agentId:    z.string().optional(),
  existingChain: z.array(
    z.object({
      org:       z.string(),
      userId:    z.string(),
      agentId:   z.string(),
      issuedAt:  z.string(),
      signature: z.string(),
    })
  ).optional(),
});

const VerifySchema = z.object({
  chain: z.array(
    z.object({
      org:       z.string(),
      userId:    z.string(),
      agentId:   z.string(),
      issuedAt:  z.string(),
      signature: z.string(),
    })
  ).min(1),
});

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop(); // 'issue' or 'verify'

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (action === 'issue') {
    const parsed = IssueSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
    }

    const { userId, resourceId, action: ctxAction, traceId, existingChain } = parsed.data;
    const ctx = {
      userId,
      resourceId,
      resourceKind: 'shared' as const,
      provider: 'local' as const,
      model: 'api',
      action: ctxAction,
      traceId,
      requestedAt: new Date().toISOString(),
    };

    const chain = existingChain
      ? issuer.extendChain(existingChain, ctx)
      : issuer.issueChain(ctx);

    return NextResponse.json({ ok: true, chain, trustDomain: FEDERATION_CONFIG.trustDomain });
  }

  if (action === 'verify') {
    const parsed = VerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
    }

    const { chain } = parsed.data;
    const ok = verifier.verify(chain);
    return NextResponse.json({
      ok,
      chain,
      entriesVerified: chain.length,
      trustedDomains: Object.keys(FEDERATION_CONFIG.trustedDomains),
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
