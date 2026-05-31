/**
 * POST /api/migrate/resolve
 *
 * Dual-credential resolution for data migration operations.
 *
 * A migration job calls this endpoint once per phase to resolve both source
 * (read) and target (write) credentials upfront. The response carries only
 * credential metadata — the raw secrets never leave the server.
 *
 * Unlike the original implementation which used the dashboard-local router
 * (sync-only, no cloud store support), this route now uses:
 *   - createRouterFromStore() from @datacules/agent-identity (full-featured)
 *   - resolvePairAsync() — parallel async resolution with correct expiresAt
 *   - getServerStore() — the configured cloud store (Vault / AWS / Azure / Memory)
 *
 * Request body:
 *   migrationId      string   — ties all phases of one run together
 *   phase            string   — dry-run | extract | transform | load | verify | rollback
 *   sourceResourceId string   — resource data is coming FROM
 *   targetResourceId string   — resource data is going TO
 *   userId           string   — identity of the migration agent
 *   provider         string   — openai | anthropic | gemini | mistral | local
 *   model            string
 *   traceId          string
 *   dryRun           boolean
 *   batchIndex?      number
 *   totalBatches?    number
 *
 * Response:
 *   200  MigrateResolveResponse (see type below)
 *   400  { error: string }   — validation failure
 *   403  { error: string }   — no rules matched source or target
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRouterFromStore } from '@datacules/agent-identity';
import { getServerStore, getServerRules } from '@/lib/server/credentialStore';
import type { MigrationContext, MigrationPhase, SupportedProvider } from '@/lib/types';

// ─── Request / Response types ─────────────────────────────────────────────────

interface MigrateResolveRequest {
  migrationId:      string;
  phase:            MigrationPhase;
  sourceResourceId: string;
  targetResourceId: string;
  userId:           string;
  provider:         SupportedProvider;
  model:            string;
  traceId:          string;
  dryRun:           boolean;
  batchIndex?:      number;
  totalBatches?:    number;
}

interface MigrateResolveResponse {
  migrationId:        string;
  phase:              MigrationPhase;
  sourceCredentialId: string;
  sourceResolvedFor:  string;
  targetCredentialId: string;
  targetResolvedFor:  string;
  dryRun:             boolean;
  /** ISO 8601 — earliest expiry across both resolved credentials */
  expiresAt?:         string;
}

const VALID_PHASES: MigrationPhase[] = [
  'dry-run', 'extract', 'transform', 'load', 'verify', 'rollback',
];

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: MigrateResolveRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Field-level validation — migrationId and phase are always required
  const requiredFields: (keyof MigrateResolveRequest)[] = [
    'migrationId', 'phase', 'sourceResourceId', 'targetResourceId',
    'userId', 'provider', 'model', 'traceId',
  ];
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return NextResponse.json(
        { error: `Missing required field: ${field}` },
        { status: 400 }
      );
    }
  }

  if (!VALID_PHASES.includes(body.phase)) {
    return NextResponse.json(
      { error: `Invalid phase "${body.phase}". Must be one of: ${VALID_PHASES.join(', ')}` },
      { status: 400 }
    );
  }

  // Build a full MigrationContext from the request fields.
  // action is derived from phase: dry-run / extract / transform / verify → read;
  // load / rollback → write (the router enforces readOnly rules independently).
  const ctx: MigrationContext = {
    userId:           body.userId,
    resourceId:       body.sourceResourceId, // overridden per-credential in resolvePairAsync
    resourceKind:     'shared',              // migrations operate on shared / service resources
    provider:         body.provider,
    model:            body.model,
    action:           (body.phase === 'load' || body.phase === 'rollback') ? 'write' : 'read',
    traceId:          body.traceId,
    requestedAt:      new Date().toISOString(),
    migrationId:      body.migrationId,
    phase:            body.phase,
    sourceResourceId: body.sourceResourceId,
    targetResourceId: body.targetResourceId,
    dryRun:           body.dryRun ?? false,
    batchIndex:       body.batchIndex,
    totalBatches:     body.totalBatches,
  };

  // Resolve both credentials in parallel using the configured cloud store.
  const store  = await getServerStore();
  const rules  = await getServerRules();
  const router = createRouterFromStore(store, rules);
  const pair   = await router.resolvePairAsync(ctx);

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

  const response: MigrateResolveResponse = {
    migrationId:        pair.migrationId,
    phase:              body.phase,
    sourceCredentialId: pair.source.credentialId,
    sourceResolvedFor:  pair.source.resolvedFor,
    targetCredentialId: pair.target.credentialId,
    targetResolvedFor:  pair.target.resolvedFor,
    dryRun:             ctx.dryRun,
    expiresAt:          pair.expiresAt,
  };

  return NextResponse.json(response);
}
