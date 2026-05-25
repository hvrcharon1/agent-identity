/**
 * agent-identity sidecar server.
 *
 * A minimal Express HTTP server that exposes the same two endpoints as the
 * Next.js app (/api/resolve and /api/migrate/resolve) so any language can
 * call them over HTTP without TypeScript.
 *
 * Run:
 *   docker pull datacules/agent-identity
 *   docker run -p 3001:3001 datacules/agent-identity
 *
 * Or locally:
 *   npm run dev --workspace=packages/sidecar
 *
 * Configure credentials and rules via environment variables:
 *   AGENT_IDENTITY_CREDENTIALS_JSON  — JSON array of Credential objects
 *   AGENT_IDENTITY_RULES_JSON        — JSON array of RoutingRule objects
 *   PORT                             — HTTP port (default: 3001)
 *
 * For production, replace loadCredentials() and loadRules() with calls
 * to your actual store (AwsCredentialStore, VaultCredentialStore, etc.).
 */
import express, { Request, Response, NextFunction } from 'express';
import {
  createRouter,
  AgentRequestContextSchema,
  MigrateResolveRequestSchema,
} from '@datacules/agent-identity';
import type { Credential, RoutingRule, MigrationContext } from '@datacules/agent-identity';

// Re-export schemas from the same package for the sidecar
const { AgentRequestContextSchema: ARC, MigrateResolveRequestSchema: MRR } = {
  AgentRequestContextSchema,
  MigrateResolveRequestSchema,
};

// ─── Config loader ──────────────────────────────────────────────────────────────

function loadCredentials(): Credential[] {
  const raw = process.env.AGENT_IDENTITY_CREDENTIALS_JSON;
  if (!raw) {
    console.warn('[sidecar] AGENT_IDENTITY_CREDENTIALS_JSON not set — using empty credential list');
    return [];
  }
  try {
    return JSON.parse(raw) as Credential[];
  } catch {
    throw new Error('[sidecar] AGENT_IDENTITY_CREDENTIALS_JSON is not valid JSON');
  }
}

function loadRules(): RoutingRule[] {
  const raw = process.env.AGENT_IDENTITY_RULES_JSON;
  if (!raw) {
    console.warn('[sidecar] AGENT_IDENTITY_RULES_JSON not set — using empty rules list');
    return [];
  }
  try {
    return JSON.parse(raw) as RoutingRule[];
  } catch {
    throw new Error('[sidecar] AGENT_IDENTITY_RULES_JSON is not valid JSON');
  }
}

// ─── Build router once at startup ────────────────────────────────────────────────

const credentials = loadCredentials();
const rules = loadRules();
const router = createRouter(credentials, rules);

// ─── Express app ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, credentialCount: credentials.length, ruleCount: rules.length });
});

// POST /api/resolve
app.post('/api/resolve', (req: Request, res: Response) => {
  const parsed = ARC.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const resolved = router.resolve(parsed.data);
  if (!resolved) {
    return res.status(403).json({ error: 'No credential resolved for this context' });
  }

  return res.json({ ok: true, resolvedFor: resolved.resolvedFor });
});

// POST /api/migrate/resolve
app.post('/api/migrate/resolve', (req: Request, res: Response) => {
  const parsed = MRR.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
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

  const pair = router.resolvePair(ctx);
  if (!pair) {
    return res.status(403).json({
      error:
        `Could not resolve credentials for phase "${body.phase}" — ` +
        'check routing rules for source/target resourceIds and provider.',
    });
  }

  return res.json({
    migrationId:       pair.migrationId,
    phase:             body.phase,
    sourceResolvedFor: pair.source.resolvedFor,
    targetResolvedFor: pair.target.resolvedFor,
    dryRun:            ctx.dryRun,
    expiresAt:         pair.expiresAt,
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[sidecar] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ──────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`[agent-identity sidecar] Listening on http://0.0.0.0:${PORT}`);
  console.log(`  Credentials loaded : ${credentials.length}`);
  console.log(`  Routing rules      : ${rules.length}`);
  console.log(`  Health             : GET  /health`);
  console.log(`  Resolve            : POST /api/resolve`);
  console.log(`  Migrate resolve    : POST /api/migrate/resolve`);
});

export { app }; // for testing
