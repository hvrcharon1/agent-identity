#!/usr/bin/env npx tsx
/**
 * OpenAPI spec generator — produces docs/openapi.yaml from Zod schemas.
 *
 * Uses @asteasolutions/zod-to-openapi to derive the OpenAPI 3.1 spec from
 * packages/core/src/schemas.ts, eliminating manual drift between the Zod
 * source of truth and the published API documentation.
 *
 * Usage:
 *   npx tsx scripts/generate-openapi.ts
 *
 * Output:
 *   docs/openapi.yaml (overwritten)
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

extendZodWithOpenApi(z);

// ─── Import schemas from core ───────────────────────────────────────────────

import {
  SupportedProviderSchema,
  ResourceKindSchema,
  MigrationPhaseSchema,
  AgentRequestContextSchema,
  MigrationContextSchema,
  CredentialSchema,
  RoutingRuleSchema,
} from '../packages/core/src/schemas';

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new OpenAPIRegistry();

// Register reusable schemas
const SupportedProvider = registry.register('SupportedProvider', SupportedProviderSchema.openapi({ description: 'AI provider identifier' }));
const ResourceKind = registry.register('ResourceKind', ResourceKindSchema.openapi({ description: 'Resource access scope' }));
const MigrationPhase = registry.register('MigrationPhase', MigrationPhaseSchema.openapi({ description: 'Migration lifecycle phase' }));

const AgentRequestContext = registry.register('AgentRequestContext', AgentRequestContextSchema.openapi({ description: 'Context for credential resolution' }));
const MigrateResolveRequest = registry.register('MigrateResolveRequest', MigrationContextSchema.openapi({ description: 'Migration credential resolution request' }));

const ResolveResponse = registry.register('ResolveResponse', z.object({
  ok: z.boolean(),
  credentialId: z.string(),
  resolvedFor: z.string(),
  expiresAt: z.string().optional(),
}).openapi({ description: 'Successful credential resolution response' }));

const MigrateResolveResponse = registry.register('MigrateResolveResponse', z.object({
  migrationId: z.string(),
  phase: MigrationPhaseSchema,
  sourceCredentialId: z.string(),
  sourceResolvedFor: z.string(),
  targetCredentialId: z.string(),
  targetResolvedFor: z.string(),
  dryRun: z.boolean(),
  expiresAt: z.string().optional(),
}).openapi({ description: 'Migration credential pair resolution response' }));

const HealthResponse = registry.register('HealthResponse', z.object({
  status: z.literal('ok'),
  version: z.string(),
  timestamp: z.string(),
  credentialsLoaded: z.number(),
  rulesLoaded: z.number(),
}).openapi({ description: 'Server health check response' }));

const ApproveRequest = registry.register('ApproveRequest', z.object({
  requestId: z.string(),
  action: z.enum(['approve', 'reject']),
  resolvedBy: z.string().optional(),
  justification: z.string().optional(),
}).openapi({ description: 'Approve or reject a pending request' }));

const ApproveResponse = registry.register('ApproveResponse', z.object({
  ok: z.boolean(),
  request: z.object({
    requestId: z.string(),
    status: z.string(),
    resolvedAt: z.string().optional(),
    resolvedBy: z.string().optional(),
  }),
}).openapi({ description: 'Approval action response' }));

const BreakGlassRequest = registry.register('BreakGlassRequest', z.object({
  requestId: z.string(),
  operator: z.string().min(1),
  justification: z.string().min(10),
}).openapi({ description: 'Emergency break-glass override request' }));

const BreakGlassResponse = registry.register('BreakGlassResponse', z.object({
  ok: z.boolean(),
  warning: z.string().optional(),
  request: z.object({
    requestId: z.string(),
    status: z.literal('break_glass'),
  }),
}).openapi({ description: 'Break-glass override response' }));

const BudgetResponse = registry.register('BudgetResponse', z.object({
  credentials: z.array(z.object({
    credentialId: z.string(),
    name: z.string(),
    usage: z.object({
      hourlyCount: z.number(),
      sessions: z.number(),
      dailySpend: z.number(),
    }),
  })),
}).openapi({ description: 'Budget utilisation for all credentials' }));

const BudgetResetRequest = registry.register('BudgetResetRequest', z.object({
  credentialId: z.string(),
  counter: z.enum(['hourly', 'daily']),
}).openapi({ description: 'Reset a budget counter' }));

const OkResponse = registry.register('OkResponse', z.object({
  ok: z.boolean(),
}).openapi({ description: 'Generic success response' }));

const ErrorResponse = registry.register('Error', z.object({
  error: z.string(),
}).openapi({ description: 'Error response' }));

const AnomalyObserveResponse = registry.register('AnomalyObserveResponse', z.object({
  ok: z.boolean(),
  observed: z.string(),
  anomalies: z.array(z.object({
    type: z.string(),
    severity: z.string(),
    message: z.string(),
  })),
  blocked: z.boolean(),
}).openapi({ description: 'Anomaly detection observation result' }));

const AttestSignResponse = registry.register('AttestSignResponse', z.object({
  token: z.string(),
}).openapi({ description: 'Signed attestation token' }));

const AttestVerifyResponse = registry.register('AttestVerifyResponse', z.object({
  valid: z.boolean(),
  expired: z.boolean().optional(),
  payload: z.object({}).passthrough().optional(),
  remainingSeconds: z.number().optional(),
  error: z.string().optional(),
}).openapi({ description: 'Attestation verification result' }));

const FederationIssueResponse = registry.register('FederationIssueResponse', z.object({
  ok: z.boolean(),
  chain: z.array(z.object({
    trustDomain: z.string(),
    userId: z.string(),
    action: z.string(),
    timestamp: z.string(),
    signature: z.string(),
  })),
  trustDomain: z.string(),
}).openapi({ description: 'Federation chain issue response' }));

const FederationVerifyResponse = registry.register('FederationVerifyResponse', z.object({
  ok: z.boolean(),
  chain: z.array(z.object({})).optional(),
  entriesVerified: z.number(),
  trustedDomains: z.array(z.string()),
}).openapi({ description: 'Federation chain verification response' }));

// ─── Register paths ─────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Health check',
  description: 'Liveness probe for the agent-identity server',
  responses: { 200: { description: 'Server is healthy', content: { 'application/json': { schema: HealthResponse } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/resolve',
  summary: 'Resolve credential',
  description: 'Server-side credential resolution using the configured store and routing rules',
  request: { body: { content: { 'application/json': { schema: AgentRequestContext } } } },
  responses: {
    200: { description: 'Credential resolved', content: { 'application/json': { schema: ResolveResponse } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'No credential matched', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/migrate/resolve',
  summary: 'Resolve migration credential pair',
  description: 'Resolves separate source and target credentials for a migration context',
  request: { body: { content: { 'application/json': { schema: MigrateResolveRequest } } } },
  responses: {
    200: { description: 'Credential pair resolved', content: { 'application/json': { schema: MigrateResolveResponse } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'No credential matched', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/approve',
  summary: 'Approve or reject a pending request',
  request: { body: { content: { 'application/json': { schema: ApproveRequest } } } },
  responses: {
    200: { description: 'Action applied', content: { 'application/json': { schema: ApproveResponse } } },
    404: { description: 'Request not found', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'Request not pending', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/approve/break-glass',
  summary: 'Emergency break-glass override',
  description: 'Bypasses approval flow. Logged as a non-deletable audit entry.',
  request: { body: { content: { 'application/json': { schema: BreakGlassRequest } } } },
  responses: {
    200: { description: 'Override applied', content: { 'application/json': { schema: BreakGlassResponse } } },
    404: { description: 'Request not found', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'Request not pending', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/budget',
  summary: 'Get budget utilisation',
  description: 'Returns per-credential hourly count, concurrent sessions, and daily spend',
  responses: { 200: { description: 'Budget data', content: { 'application/json': { schema: BudgetResponse } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/budget',
  summary: 'Reset budget counter',
  request: { body: { content: { 'application/json': { schema: BudgetResetRequest } } } },
  responses: { 200: { description: 'Counter reset', content: { 'application/json': { schema: OkResponse } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/anomaly',
  summary: 'Observe agent request for anomalies',
  request: { body: { content: { 'application/json': { schema: AgentRequestContext } } } },
  responses: {
    200: { description: 'Observation recorded', content: { 'application/json': { schema: AnomalyObserveResponse } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/anomaly',
  summary: 'Reset anomaly baseline',
  parameters: [{ name: 'userId', in: 'query', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Baseline reset', content: { 'application/json': { schema: OkResponse } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/attest/sign',
  summary: 'Sign attestation token',
  description: 'Creates a signed JWT attestation token for a credential resolution',
  responses: {
    200: { description: 'Token signed', content: { 'application/json': { schema: AttestSignResponse } } },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/attest',
  summary: 'Verify attestation token',
  description: 'Verifies a signed JWT attestation token',
  responses: {
    200: { description: 'Verification result', content: { 'application/json': { schema: AttestVerifyResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/federation/issue',
  summary: 'Issue identity chain',
  description: 'Creates or extends a cross-domain identity chain',
  responses: {
    200: { description: 'Chain issued', content: { 'application/json': { schema: FederationIssueResponse } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/federation/verify',
  summary: 'Verify identity chain',
  description: 'Verifies all entries in a cross-domain identity chain',
  responses: {
    200: { description: 'Chain verified', content: { 'application/json': { schema: FederationVerifyResponse } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ─── Generate ────────────────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Agent Identity API',
    version: '0.11.1',
    description: 'Provider-agnostic credential routing and identity management for AI agents',
    license: { name: 'SEE LICENSE IN LICENSE' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
});

const outputPath = path.resolve(__dirname, '../docs/openapi.yaml');
const yamlStr = yaml.stringify(doc, { lineWidth: 120 });
fs.writeFileSync(outputPath, yamlStr, 'utf-8');

console.log(`OpenAPI spec written to ${outputPath}`);
console.log(`  Paths: ${Object.keys(doc.paths ?? {}).length}`);
console.log(`  Schemas: ${Object.keys(doc.components?.schemas ?? {}).length}`);
