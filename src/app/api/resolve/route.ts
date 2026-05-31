/**
 * POST /api/resolve
 *
 * Server-side credential resolution. Validates the request with Zod,
 * resolves via the configured CredentialStore (Vault / AWS / Azure / Memory),
 * and returns safe metadata — never the raw credential secret.
 *
 * The store backend is selected by CREDENTIAL_STORE_TYPE; see
 * src/lib/server/credentialStore.ts for full configuration reference.
 *
 * Response:
 *   200  { ok: true, credentialId, resolvedFor, expiresAt? }
 *   400  { error: ZodFlattenedError }   — request schema validation failed
 *   403  { error: string }              — no rule matched / credential expired
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouterFromStore } from '@datacules/agent-identity';
import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';
import { getServerStore, getServerRules } from '@/lib/server/credentialStore';

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

  // getServerStore() returns the configured cloud store (Vault / AWS / Azure)
  // or MemoryCredentialStore when no production store is configured.
  const store  = await getServerStore();
  const rules  = await getServerRules();
  const router = createRouterFromStore(store, rules);

  // resolveAsync works with all CredentialStore implementations (sync + async),
  // and also applies approval gates, budget enforcement, and attestation signing
  // when those features are configured via RouterConfig.
  const resolved = await router.resolveAsync(ctx);

  if (!resolved) {
    return NextResponse.json(
      { error: 'No credential resolved for this context' },
      { status: 403 }
    );
  }

  // Return safe metadata only — never the raw credential ref or secret.
  return NextResponse.json({
    ok: true,
    credentialId: resolved.credentialId,
    resolvedFor:  resolved.resolvedFor,
    expiresAt:    resolved.expiresAt,
  });
}
