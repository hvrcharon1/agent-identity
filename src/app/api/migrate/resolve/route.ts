/**
 * POST /api/migrate/resolve — Dual-credential resolution for migration operations.
 *
 * A migration job calls this endpoint ONCE at the start of each phase to
 * establish both source (read) and target (write) credentials upfront.
 * The response returns only metadata (no secrets) plus an expiry window
 * the agent can use to decide when to refresh before the batch loop ends.
 *
 * Architecture:
 *   Migration agent → POST /api/migrate/resolve → Server resolves pair →
 *   Encrypted store → Agent proceeds with batch loop
 *
 * Benefits over calling /api/resolve twice:
 * - One round-trip per phase instead of N round-trips per row
 * - Response carries the earliest expiry of both credentials
 * - Phase is logged together with both credential IDs in one audit entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouter } from '@/lib/router';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import type { MigrationContext, MigrationPhase, SupportedProvider } from '@/lib/types';

// ─── Request / Response shapes ────────────────────────────────────────────────

interface MigrateResolveRequest {
  migrationId: string;
  phase: MigrationPhase;
  sourceResourceId: string;
  targetResourceId: string;
  userId: string;
  provider: SupportedProvider;
  model: string;
  traceId: string;
  dryRun: boolean;
  batchIndex?: number;
  totalBatches?: number;
}

interface MigrateResolveResponse {
  migrationId: string;
  phase: MigrationPhase;
  /** resolvedFor value of the source credential */
  sourceResolvedFor: string;
  /** resolvedFor value of the target credential */
  targetResolvedFor: string;
  dryRun: boolean;
  /** ISO 8601 — earliest expiry of the two credentials; undefined if neither expires */
  expiresAt?: string;
}

const VALID_PHASES: MigrationPhase[] = ['dry-run', 'extract', 'transform', 'load', 'verify', 'rollback'];

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: MigrateResolveRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  const requiredFields: (keyof MigrateResolveRequest)[] = [
    'migrationId', 'phase', 'sourceResourceId', 'targetResourceId',
    'userId', 'provider', 'model', 'traceId',
  ];
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }

  if (!VALID_PHASES.includes(body.phase)) {
    return NextResponse.json(
      { error: `Invalid phase "${body.phase}". Must be one of: ${VALID_PHASES.join(', ')}` },
      { status: 400 }
    );
  }

  // Build MigrationContext
  const ctx: MigrationContext = {
    userId: body.userId,
    resourceId: body.sourceResourceId, // router.resolvePair overrides this per credential
    resourceKind: 'shared',            // migrations operate on shared/service resources
    provider: body.provider,
    model: body.model,
    action: body.phase === 'dry-run' ? 'read' : body.phase === 'load' || body.phase === 'rollback' ? 'write' : 'read',
    traceId: body.traceId,
    requestedAt: new Date().toISOString(),
    migrationId: body.migrationId,
    phase: body.phase,
    sourceResourceId: body.sourceResourceId,
    targetResourceId: body.targetResourceId,
    dryRun: body.dryRun ?? false,
    batchIndex: body.batchIndex,
    totalBatches: body.totalBatches,
  };

  const credentials = await getServerCredentials();
  const rules = await getServerRules();
  const router = createRouter(credentials, rules);

  const pair = router.resolvePair(ctx);

  if (!pair) {
    return NextResponse.json(
      {
        error: 'Could not resolve credentials for this migration context. ' +
          'Check that routing rules exist for both sourceResourceId and targetResourceId ' +
          `with phase "${body.phase}" and provider "${body.provider}".`,
      },
      { status: 403 }
    );
  }

  const response: MigrateResolveResponse = {
    migrationId: pair.migrationId,
    phase: body.phase,
    sourceResolvedFor: pair.source.resolvedFor,
    targetResolvedFor: pair.target.resolvedFor,
    dryRun: ctx.dryRun,
    expiresAt: pair.expiresAt,
  };

  return NextResponse.json(response);
}
