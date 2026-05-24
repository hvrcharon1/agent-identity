/**
 * POST /api/resolve — Server-side credential resolution (Finding #1).
 *
 * The client sends an AgentRequestContext. The server resolves the credential
 * from an encrypted store and injects it into the outbound AI call.
 * The client NEVER sees the credential ref or secret.
 *
 * Architecture:
 *   Browser → POST /api/resolve → Server resolves ref → encrypted store → AI provider
 */
import { NextRequest, NextResponse } from 'next/server';
 import { createRouter } from '@/lib/router';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import type { AgentRequestContext } from '@/lib/types';

export async function POST(req: NextRequest) {
  let ctx: AgentRequestContext;

  try {
    ctx = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  const required: (keyof AgentRequestContext)[] = [
    'userId', 'resourceId', 'resourceKind', 'provider', 'model', 'action',
    'traceId', 'requestedAt',
  ];
  for (const field of required) {
    if (!ctx[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}` },
        { status: 400 }
      );
    }
  }

  const credentials = await getServerCredentials();
  const rules = await getServerRules();
  const router = createRouter(credentials, rules);
  const resolved = router.resolve(ctx);

  if (!resolved) {
    return NextResponse.json(
      { error: 'No credential resolved for this context' },
      { status: 403 }
    );
  }

  // TODO: Inject credential server-side and call the AI provider here.
  // Return only the sanitised AI response — never the ref or secret.
  // Example:
  //   const adapter = getAdapter(ctx.provider);
  //   const injectedRequest = adapter.injectCredential(aiRequest, resolved);
  //   const aiResponse = await callAIProvider(ctx.provider, injectedRequest, resolved.ref);
  //   return NextResponse.json(aiResponse);

  // Placeholder response until AI provider call is wired up:
  return NextResponse.json({ ok: true, resolvedFor: resolved.resolvedFor });
}
