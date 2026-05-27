import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FederationIssuer } from '@/lib/federation';
import type { FederationConfig } from '@/lib/federation';

const FEDERATION_CONFIG: FederationConfig = {
  trustDomain: 'acme.com',
  trustedDomains: { 'acme.com': 'MCowBQYDK2VwAyEA...acme', 'vendor.com': 'MCowBQYDK2VwAyEA...vendor', 'audit.io': 'MCowBQYDK2VwAyEA...audit' },
};

const issuer = new FederationIssuer(FEDERATION_CONFIG.trustDomain, 'api-agent');

const IssueSchema = z.object({
  userId: z.string().min(1), resourceId: z.string().min(1), action: z.string().min(1), traceId: z.string().min(1),
  existingChain: z.array(z.object({ org: z.string(), userId: z.string(), agentId: z.string(), issuedAt: z.string(), signature: z.string() })).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = IssueSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });

  const { userId, resourceId, action, traceId, existingChain } = parsed.data;
  const ctx = { userId, resourceId, resourceKind: 'shared' as const, provider: 'local' as const, model: 'api', action, traceId, requestedAt: new Date().toISOString() };
  const chain = existingChain ? issuer.extendChain(existingChain, ctx) : issuer.issueChain(ctx);
  return NextResponse.json({ ok: true, chain, trustDomain: FEDERATION_CONFIG.trustDomain });
}
