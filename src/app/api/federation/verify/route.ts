import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FederationVerifier } from '@/lib/federation';
import type { FederationConfig } from '@/lib/federation';

const FEDERATION_CONFIG: FederationConfig = {
  trustDomain: 'acme.com',
  trustedDomains: { 'acme.com': 'MCowBQYDK2VwAyEA...acme', 'vendor.com': 'MCowBQYDK2VwAyEA...vendor', 'audit.io': 'MCowBQYDK2VwAyEA...audit' },
};

const verifier = new FederationVerifier(FEDERATION_CONFIG);

const VerifySchema = z.object({
  chain: z.array(z.object({ org: z.string(), userId: z.string(), agentId: z.string(), issuedAt: z.string(), signature: z.string() })).min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });

  const { chain } = parsed.data;
  const ok = verifier.verify(chain);
  return NextResponse.json({ ok, chain, entriesVerified: chain.length, trustedDomains: Object.keys(FEDERATION_CONFIG.trustedDomains) });
}
