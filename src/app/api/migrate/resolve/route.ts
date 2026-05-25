/**
 * POST /api/migrate/resolve — Dual-credential resolution for migration operations.
 *
 * Upgraded to use Zod schema validation (Task 7).
 * Replaces manual field-by-field checks with MigrateResolveRequestSchema.safeParse().
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouter } from '@/lib/router';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import { MigrateResolveRequestSchema } from '@/lib/schemas';
import type { MigrationContext } from '@/lib/types';

export async function POST(req: NextRequest) {
  let rawBody: unknown;

  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = MigrateResolveRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const ctx: MigrationContext = {
    userId:           body.userId,
    resourceId:       body.sourceResourceId,
    resourceKind:     'shared',
    provider:         body.provider,
    model:            body.model,
    action:
      body.phase === 'dry-run'
        ? 'read'
        : body.phase === 'load' || body.phase === 'rollback'
        ? 'write'
        : 'read',
    traceId:          body.traceId,
    requestedAt:      new Date().toISOString(),
    migrationId:      body.migrationId,
    phase:            body.phase,
    sourceResourceId: body.sourceResourceId,
    targetResourceId: body.targetResourceId,
    dryRun:           body.dryRun,
    batchIndex:       body.batchIndex,
    totalBatches:     body.totalBatches,
  };

  const credentials = await getServerCredentials();
  const rules       = await getServerRules();
  const router      = createRouter(credentials, rules);
  const pair        = router.resolvePair(ctx);

  if (!pair) {
    return NextResponse.json(
      {
        error:
          'Could not resolve credentials for this migration context. ' +
          'Check that routing rules exist for both sourceResourceId and targetResourceId ' +
          `with phase "${body.phase}" and provider "${body.provider}".`,
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    migrationId:       pair.migrationId,
    phase:             body.phase,
    sourceResolvedFor: pair.source.resolvedFor,
    targetResolvedFor: pair.target.resolvedFor,
    dryRun:            ctx.dryRun,
    expiresAt:         pair.expiresAt,
  });
}
