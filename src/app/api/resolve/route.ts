/**
 * POST /api/resolve — updated to use Zod validation (suggestion #7).
 *
 * Replaces the manual field-by-field validation loop with a single
 * AgentRequestContextSchema.safeParse() call. Error messages now include
 * the exact field path and constraint that failed, not just the field name.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouterFromStore } from '@datacules/agent-identity';
import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import { MemoryCredentialStore } from '@datacules/agent-identity';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AgentRequestContextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ctx = parsed.data;
  const credentials = await getServerCredentials();
  const rules = await getServerRules();
  const store = new MemoryCredentialStore(credentials);
  const router = createRouterFromStore(store, rules);
  const resolved = router.resolve(ctx);

  if (!resolved) {
    return NextResponse.json(
      { error: 'No credential resolved for this context' },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true, resolvedFor: resolved.resolvedFor });
}
