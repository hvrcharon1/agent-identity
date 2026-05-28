/**
 * Example: Anthropic + Fixed Service-Account Credential
 *
 * The simplest pattern: a single fixed API key used for all requests.
 * All users are equal — no per-user credential management.
 * Supplement with audit logging for traceability.
 *
 * Use when: internal tools, wikis, task boards, shared team resources.
 * Avoid when: users have different access levels to the same resource.
 *
 * Run:
 *   node index.js
 */

import { createRouter, anthropicAdapter } from '@datacules/agent-identity';
import { ConsoleAuditLogger, WebhookAuditLogger, CompositeAuditLogger } from '@datacules/agent-identity-audit';

// ─── 1. Single fixed credential ───────────────────────────────────────────────
const credentials = [
  {
    id: 'cred-anthropic-service',
    kind: 'fixed',
    name: 'Anthropic service account',
    status: 'active',
    provider: 'anthropic',
    scope: 'read write',
    ref: 'vault:anthropic/service-account-slot',
    // Rotation policy — optional but recommended
    rotationIntervalDays: 30,
  },
];

// ─── 2. Single catch-all rule ─────────────────────────────────────────────────
const rules = [
  {
    id: 'rule-all-anthropic',
    credentialRef: 'vault:anthropic/service-account-slot',
    priority: 10,
    matchProvider: 'anthropic',
  },
];

// ─── 3. Composite audit logger (console + optional webhook) ───────────────────
// In production you'd add a DatadogAuditLogger or SplunkAuditLogger here.
const logger = new ConsoleAuditLogger();
const router = createRouter(credentials, rules, logger);

// ─── 4. Simulate requests from multiple users to the same shared resource ──────
const users = ['user-anna', 'user-bob', 'user-carlos'];

console.log('\n=== Fixed credential routing ===');
console.log('All users resolve to the same service account.\n');

for (const userId of users) {
  const ctx = {
    userId,
    resourceId: 'company-knowledge-base',
    resourceKind: 'shared',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    action: 'read',
    traceId: `trace-${userId}-${Date.now()}`,
    sessionId: `session-${userId}`,
    requestedAt: new Date().toISOString(),
  };

  const resolved = router.resolve(ctx);

  if (!resolved) {
    console.error(`[${userId}] No credential matched.`);
    continue;
  }

  console.log(`[${userId}]`);
  console.log(`  credential: ${resolved.credentialId} (${resolved.kind})`);
  console.log(`  ref       : ${resolved.ref}`);

  // Validate the credential is suitable for this provider before injecting
  const validation = anthropicAdapter.validate?.(resolved);
  console.log(`  valid     : ${validation?.valid ?? true}`);
}

console.log('\nEvery resolution above is in the audit log.');
console.log('Even with a fixed credential, every user\'s action is traceable via userId + traceId.\n');

// ─── 5. Show the injection API ────────────────────────────────────────────────
console.log('--- Injection example ---');
const sampleResolved = router.resolve({
  userId: 'user-demo',
  resourceId: 'demo-resource',
  resourceKind: 'shared',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  action: 'read',
  traceId: 'trace-demo',
  requestedAt: new Date().toISOString(),
});

if (sampleResolved) {
  const apiConfig = anthropicAdapter.injectCredential(sampleResolved, {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Summarise the knowledge base.' }],
  });
  console.log('x-api-key header set:', !!apiConfig.headers?.['x-api-key']);
  console.log('anthropic-version set:', !!apiConfig.headers?.['anthropic-version']);
}
