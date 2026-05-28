/**
 * Example: OpenAI + User-Delegated Auth
 *
 * Demonstrates per-user credential routing. Each user resolves their own
 * OpenAI API key — the model layer never receives any raw secret.
 *
 * Run:
 *   node index.js
 */

import { createRouter, openaiAdapter } from '@datacules/agent-identity';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// ─── 1. Define credentials (one per user) ─────────────────────────────────────
// In production these refs point to your encrypted vault (AWS Secrets Manager,
// HashiCorp Vault, Azure Key Vault). Here we use placeholder refs.
const credentials = [
  {
    id: 'cred-user-alice',
    kind: 'user-delegated',
    name: 'Alice — OpenAI delegated token',
    status: 'active',
    provider: 'openai',
    scope: 'read write',
    ref: 'vault:openai/user-alice-slot',  // vault path — router never reads the raw value
  },
  {
    id: 'cred-user-bob',
    kind: 'user-delegated',
    name: 'Bob — OpenAI delegated token',
    status: 'active',
    provider: 'openai',
    scope: 'read write',
    ref: 'vault:openai/user-bob-slot',
  },
];

// ─── 2. Define routing rules ───────────────────────────────────────────────────
// Per-user rules: match on userId, route to that user's credential.
// Higher priority number = evaluated first.
const rules = [
  {
    id: 'rule-alice',
    credentialRef: 'vault:openai/user-alice-slot',
    priority: 20,
    matchUserId: 'user-alice',
    matchResourceKind: 'personal',
    matchProvider: 'openai',
  },
  {
    id: 'rule-bob',
    credentialRef: 'vault:openai/user-bob-slot',
    priority: 20,
    matchUserId: 'user-bob',
    matchResourceKind: 'personal',
    matchProvider: 'openai',
  },
];

// ─── 3. Create router with audit logging ──────────────────────────────────────
const logger = new ConsoleAuditLogger();
const router = createRouter(credentials, rules, logger);

// ─── 4. Simulate two concurrent user requests ─────────────────────────────────
const users = ['user-alice', 'user-bob'];

for (const userId of users) {
  const ctx = {
    userId,
    resourceId: `${userId}-documents`,
    resourceKind: 'personal',
    provider: 'openai',
    model: 'gpt-4o',
    action: 'read',
    traceId: `trace-${userId}-${Date.now()}`,
    requestedAt: new Date().toISOString(),
  };

  const resolved = router.resolve(ctx);

  if (!resolved) {
    console.error(`[${userId}] No credential matched — check rules and credential status.`);
    continue;
  }

  // The ref is used to look up the raw secret from the vault at call time.
  // The model / calling code only ever sees the resolved ref, not the raw API key.
  console.log(`\n[${userId}] Resolved credential:`);
  console.log(`  id   : ${resolved.credentialId}`);
  console.log(`  kind : ${resolved.kind}`);
  console.log(`  ref  : ${resolved.ref}`);

  // Inject into an OpenAI request config (the adapter builds the Authorization header)
  const openAIConfig = openaiAdapter.injectCredential(
    resolved,
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello!' }] }
  );
  console.log(`  Authorization header set: ${!!openAIConfig.headers?.['Authorization']}`);
}

console.log('\nAudit log (above) shows every resolution with full traceability.');
console.log('The raw API keys never appear in this output — only the credential refs.\n');
