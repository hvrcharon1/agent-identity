/**
 * Example: Hybrid / Context-Switched Credential Routing
 *
 * A single agent session touches both shared resources (wiki, task board)
 * and personal resources (user's calendar, documents). The router
 * automatically selects the right credential for each resource kind.
 *
 * Run:
 *   node index.js
 */

import { createRouter, anthropicAdapter } from '@datacules/agent-identity';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// ─── 1. Credentials ───────────────────────────────────────────────────────────
const credentials = [
  // Fixed service account — used for shared resources (wiki, task board)
  {
    id: 'cred-service-anthropic',
    kind: 'fixed',
    name: 'Anthropic service account',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/service-account-slot',
  },
  // User-delegated tokens — one per active user for personal resources
  {
    id: 'cred-user-carol',
    kind: 'user-delegated',
    name: 'Carol — Anthropic delegated token',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/user-carol-slot',
  },
  {
    id: 'cred-user-dave',
    kind: 'user-delegated',
    name: 'Dave — Anthropic delegated token',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/user-dave-slot',
  },
];

// ─── 2. Routing rules ─────────────────────────────────────────────────────────
// Rule priority: higher = evaluated first.
// Per-user rules (priority 30) take precedence over the shared fallback (priority 10).
const rules = [
  // Personal resource: route to the requesting user's own credential
  {
    id: 'rule-carol-personal',
    credentialRef: 'vault:anthropic/user-carol-slot',
    priority: 30,
    matchUserId: 'user-carol',
    matchResourceKind: 'personal',
    matchProvider: 'anthropic',
  },
  {
    id: 'rule-dave-personal',
    credentialRef: 'vault:anthropic/user-dave-slot',
    priority: 30,
    matchUserId: 'user-dave',
    matchResourceKind: 'personal',
    matchProvider: 'anthropic',
  },
  // Shared resource: any user → service account (no per-user traceability needed)
  {
    id: 'rule-shared',
    credentialRef: 'vault:anthropic/service-account-slot',
    priority: 10,
    matchResourceKind: 'shared',
    matchProvider: 'anthropic',
  },
];

// ─── 3. Router ────────────────────────────────────────────────────────────────
const logger = new ConsoleAuditLogger();
const router = createRouter(credentials, rules, logger);

// ─── 4. Simulate a hybrid session for user-carol ──────────────────────────────
// Carol's agent touches both a shared wiki and her personal documents
const session = [
  {
    label: 'Read shared wiki',
    ctx: {
      userId: 'user-carol',
      resourceId: 'company-wiki',
      resourceKind: 'shared',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      action: 'read',
      traceId: 'trace-carol-001',
      requestedAt: new Date().toISOString(),
    },
  },
  {
    label: 'Write to personal documents',
    ctx: {
      userId: 'user-carol',
      resourceId: 'carol-private-docs',
      resourceKind: 'personal',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      action: 'write',
      traceId: 'trace-carol-002',
      requestedAt: new Date().toISOString(),
    },
  },
  {
    label: 'Dave reads shared task board',
    ctx: {
      userId: 'user-dave',
      resourceId: 'team-task-board',
      resourceKind: 'shared',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      action: 'read',
      traceId: 'trace-dave-001',
      requestedAt: new Date().toISOString(),
    },
  },
];

console.log('\n=== Hybrid routing simulation ===\n');

for (const { label, ctx } of session) {
  const resolved = router.resolve(ctx);

  if (!resolved) {
    console.error(`[MISS] ${label} — no credential matched`);
    continue;
  }

  const icon = resolved.kind === 'fixed' ? '🔧' : '👤';
  console.log(`${icon} ${label}`);
  console.log(`   user       : ${ctx.userId}`);
  console.log(`   resource   : ${ctx.resourceId} (${ctx.resourceKind})`);
  console.log(`   credential : ${resolved.credentialId} (${resolved.kind})`);
  console.log(`   ref        : ${resolved.ref}`);
  console.log();
}

console.log('Key insight: Carol\'s personal actions use her delegated token (traceable).');
console.log('Shared actions use the service account — no per-user token management required.\n');
