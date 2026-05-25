/**
 * POST /api/resolve — Server-side credential resolution.
 *
 * Upgraded to use Zod schema validation (Task 7).
 * Replaces manual field-by-field checks with AgentRequestContextSchema.safeParse().
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouter } from '@/lib/router';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import { AgentRequestContextSchema } from '@/lib/schemas';

export async function POST(req: NextRequest) {
  let rawBody: unknown;

  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AgentRequestContextSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ctx = parsed.data;
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

  return NextResponse.json({
    ok:          true,
    resolvedFor: resolved.resolvedFor,
    // expiresAt is returned so clients (and useAgentIdentity hook) can schedule refresh
    expiresAt:   undefined, // populated once real store is wired
  });
}
