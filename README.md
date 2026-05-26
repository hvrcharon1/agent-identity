<p align="center">
  <img src="assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="520"/>
</p>

<p align="center">
  <strong>Agent Identity & Auth Patterns</strong><br/>
  <sub>A provider-agnostic framework by <a href="https://datacules.com">Datacules LLC</a></sub>
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Datacules%20Open%20Source-black?style=flat-square" alt="License"/>
  </a>
  <a href="https://github.com/hvrcharon1/agent-identity/stargazers">
    <img src="https://img.shields.io/github/stars/hvrcharon1/agent-identity?style=flat-square&color=black" alt="Stars"/>
  </a>
  <img src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Mistral%20%7C%20Local-black?style=flat-square" alt="Supported providers"/>
  <img src="https://img.shields.io/badge/stack-Next.js%20%2B%20TypeScript-black?style=flat-square" alt="Stack"/>
  <img src="https://img.shields.io/badge/data%20migration-phase--aware%20routing-black?style=flat-square" alt="Data migration support"/>
</p>

---

## 🔍 Picture this

> Your AI agent just modified 47 files, sent 3 emails, and closed 2 Linear tickets.
>
> Something went wrong. Your manager asks: **who authorised that?**
>
> You check the logs.
>
> *The agent did it.*
>
> ...That's it. That's all the trail you have.

**This is the identity gap in agentic AI — and it's sitting quietly inside most production agent systems right now.**

When an AI agent acts on behalf of a user, it needs to know three things:

- **Whose identity am I carrying?**
- **Which credential is appropriate for this specific resource?**
- **Can I be audited, traced, and held accountable for this action?**

Without explicit answers, you get silent privilege escalation, raw credentials in context windows, and action chains that are completely anonymous across multi-agent pipelines.

So we built something to solve it: **`agent-identity`** — open-source, provider-agnostic, built for production.

---

> **AI agents are executing real actions — merging code, modifying databases, sending emails, calling APIs on behalf of real people. The question of *who* the agent is acting as, and *with which credentials*, is no longer academic. It is a production-grade engineering concern.**

A provider-agnostic framework for AI agents that act on behalf of users and services — with precise, auditable credential routing. Works with OpenAI, Anthropic, Gemini, Mistral, and local models out of the box.

---

## Installation

Choose the integration path that fits your stack. All options share the same credential routing engine, type system, and audit interface.

### Node.js / TypeScript (npm package)

```bash
npm install @datacules/agent-identity
```

```typescript
import { createRouter, MemoryCredentialStore } from '@datacules/agent-identity';
import type { AgentRequestContext } from '@datacules/agent-identity';

const router = createRouter(credentials, rules, logger);

const ctx: AgentRequestContext = {
  userId: 'user-abc',
  resourceId: 'knowledge-base',
  resourceKind: 'personal',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  action: 'read',
  traceId: crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
};

const resolved = router.resolve(ctx);
// resolved.resolvedFor → 'user-abc'
// resolved.ref        → opaque vault ref — the model layer never sees the raw secret
```

Works in any Node.js environment: Next.js, Express, Fastify, NestJS, LangChain, LangGraph, or a plain script.

---

### React hook (`@datacules/agent-identity/react`)

The hook calls `POST /api/resolve` server-side — the raw credential never reaches the browser.

```typescript
import { useAgentIdentity } from '@datacules/agent-identity/react';

function AiComposer({ userId }: { userId: string }) {
  const ctx = {
    userId,
    resourceId: 'knowledge-base',
    resourceKind: 'personal' as const,
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    action: 'read',
    traceId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  };

  const { resolvedFor, loading, error, expiresAt } = useAgentIdentity(ctx);

  if (loading) return <p>Resolving credentials…</p>;
  if (error)   return <p>Auth error: {error.message}</p>;

  return (
    <div>
      <p>Ready — acting as {resolvedFor}</p>
      {expiresAt && <p>Session valid until {new Date(expiresAt).toLocaleTimeString()}</p>}
    </div>
  );
}
```

Features: full `loading` / `error` / `expiresAt` lifecycle, auto-refresh 60 s before credential expiry, configurable `onError` callback.

---

### Zod schemas (`@datacules/agent-identity/schemas`)

For runtime validation in route handlers — replaces manual field-by-field checks with structured error output:

```typescript
import { AgentRequestContextSchema } from '@datacules/agent-identity/schemas';

const parsed = AgentRequestContextSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
}
const ctx = parsed.data; // fully typed AgentRequestContext
```

Also usable for OpenAPI spec generation via `zod-to-json-schema` and Python Pydantic model generation.

---

### Express middleware

```bash
npm install @datacules/agent-identity-express
```

```typescript
import express from 'express';
import { agentIdentityMiddleware } from '@datacules/agent-identity-express';

const app = express();

app.use('/ai', agentIdentityMiddleware({ credentials, rules, logger }));

app.post('/ai/complete', (req, res) => {
  // req.resolvedCredential is populated by the middleware
  const { ref, resolvedFor } = req.resolvedCredential!;
  // pass ref to your vault — never the raw secret
  res.json({ resolvedFor });
});
```

---

### Fastify plugin

```bash
npm install @datacules/agent-identity-fastify
```

```typescript
import Fastify from 'fastify';
import { agentIdentityPlugin } from '@datacules/agent-identity-fastify';

const app = Fastify();

await app.register(agentIdentityPlugin, { credentials, rules, logger });

app.post('/ai/complete', async (request, reply) => {
  const { ref, resolvedFor } = request.resolvedCredential!;
  return { resolvedFor };
});
```

---

### LangChain / LangGraph

```bash
npm install @datacules/agent-identity-langchain
```

```typescript
import { createAgentIdentityModel } from '@datacules/agent-identity-langchain';

const { getModel, resolved } = createAgentIdentityModel(ctx, credentials, rules, fetchSecret);
const model = await getModel(); // ChatAnthropic / ChatOpenAI — API key injected server-side

const response = await model.invoke('Summarise this document.');
```

For LangGraph, use `createAgentIdentityNode()` as a drop-in `StateGraph` node that resolves and attaches `resolvedCredential` to graph state before any LLM call.

---

### Python / non-Node languages (Docker sidecar + HTTP)

Run `agent-identity` as a language-agnostic sidecar. Any language that can make an HTTP request can use the framework.

```bash
docker pull datacules/agent-identity
docker run -p 3001:3001 datacules/agent-identity
```

Or with Compose:

```bash
docker compose up
```

Then call the API from any language:

```bash
curl -s -X POST http://localhost:3001/api/resolve \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "user-abc",
    "resourceId": "crm-db",
    "resourceKind": "shared",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "action": "read",
    "traceId": "trace-xyz",
    "requestedAt": "2026-05-26T00:00:00.000Z"
  }'
# → { "resolvedFor": "service", "credentialId": "...", "expiresAt": "..." }
```

---

### Python SDK

```bash
pip install agent-identity
```

```python
from agent_identity import AgentIdentityClient
from datetime import datetime, timezone

client = AgentIdentityClient(base_url="http://localhost:3001")

resolved = client.resolve({
    "userId": "user-abc",
    "resourceId": "crm-db",
    "resourceKind": "shared",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "action": "read",
    "traceId": "trace-xyz",
    "requestedAt": datetime.now(timezone.utc).isoformat(),
})
print(resolved["resolvedFor"])  # → "service"

# For migration workflows:
pair = client.resolve_migration({
    "migrationId": "migration-2026-q2",
    "phase": "load",
    "sourceResourceId": "crm-postgres-prod",
    "targetResourceId": "crm-postgres-v2",
    "userId": "svc-migration-bot",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "traceId": "trace-abc123",
    "dryRun": False,
})
```

Zero runtime dependencies. Fully typed with `TypedDict`. Works with LangChain, AutoGen, CrewAI, or any Python agent framework.

---

### Production credential stores

Swap out `MemoryCredentialStore` for a production-grade store:

```typescript
// AWS Secrets Manager + DynamoDB reservation locks
import { AwsCredentialStore } from '@datacules/agent-identity-store-aws';
const router = createRouterFromStore(new AwsCredentialStore(), rules, logger);

// HashiCorp Vault KV v2
import { VaultCredentialStore } from '@datacules/agent-identity-store-vault';
const router = createRouterFromStore(new VaultCredentialStore(), rules, logger);
```

---

### Audit sinks

```typescript
import {
  ConsoleAuditLogger,
  WebhookAuditLogger,
  DatadogAuditLogger,
  SplunkAuditLogger,
  CompositeAuditLogger,
} from '@datacules/agent-identity-audit';

// Fan-out to multiple sinks simultaneously
const logger = new CompositeAuditLogger([
  new ConsoleAuditLogger(),
  new DatadogAuditLogger({ apiKey: process.env.DD_API_KEY! }),
  new WebhookAuditLogger({ url: 'https://hooks.example.com/agent-audit', secret: '...' }),
]);

const router = createRouter(credentials, rules, logger);
```

---

### Interactive dashboard (local dev / demo)

```bash
git clone https://github.com/hvrcharon1/agent-identity.git
cd agent-identity
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Decision Helper wizard walks through three questions and recommends the right auth pattern. The **Data migration** tab covers phase-aware routing with copyable rule examples.

---

## Why this exists — the identity problem in agentic AI

Every AI agent that touches a real system must answer three questions before it acts:

1. **Who am I acting as?** — a specific user, a shared service account, or the agent itself?
2. **Which credential do I use?** — the user's own token, or a fixed service key?
3. **When do I switch between them?** — if the agent handles both shared and personal resources in the same workflow, the answer changes per task.

Without an explicit answer to all three, you get one of these failure modes in production:

- An agent silently acts with more privilege than the user it represents (credential escalation)
- A breach exposes raw API keys because the model layer received them directly
- An audit trail that says "the agent did it" — with no traceable human principal behind the action
- A multi-agent pipeline where intermediate hops are completely anonymous

`agent-identity` makes those decisions explicit, configurable, and auditable — across any AI provider.

---

## The two patterns that cover most real-world cases

### 🔴 Pattern 1 — Fixed credential (shared resource access)

```
User 1 ─┐
User 2 ──▶  [ AI Agent ]  ──▶  Fixed Auth  ──▶  Shared task board
User 3 ─┘                                        (all users have same access)
```

One agent, one shared credential, one downstream resource. All users are equal. Perfect for shared tools — task boards, internal wikis, analytics dashboards. Zero per-user complexity.

Simple and low-overhead, but supplement with request-level audit logging since the credential itself carries no per-user signal.

### 🟢 Pattern 2 — Individual user auth (variable access)

```
User 1 ──[ User 1 Auth ]─┐
User 2 ──[ User 2 Auth ]──▶  [ AI Agent ]  ──▶  Individual User Auth  ──▶  Company knowledge base
User 3 ──[ User 3 Auth ]─┘                                                   (variable document access)
```

Each user brings their own token. The agent can only do what that user is already allowed to do. Perfect for anything with variable access — knowledge bases, personal data, financial systems.

More credential management overhead, but the only architecturally sound choice when access levels differ.

These two patterns, plus **hybrid / context-switched** (both in one workflow) and **token exchange / impersonation** (OAuth STS), cover the full space of real-world agentic auth requirements.

---

## The framework wraps both patterns in a credential routing engine that

- 🔒 **Never exposes raw credentials to the model layer**
- 🏷️ **Tags every agent action with a traceable human principal**
- ⚖️ **Enforces least-privilege by architecture, not by convention**
- 🔌 **Plugs into OpenAI, Anthropic, Gemini, Mistral, or any local model**
- 🗄️ **Supports safe, auditable data migration with phase-aware credential routing**

---

## Why this matters right now

> The teams who build the identity and accountability layer now will be the ones who scale confidently — while others scramble to retrofit governance onto systems that were never designed for it.

### The pace of agentic AI adoption is outrunning its infrastructure

In 2024–2026, AI agents moved from demos to production at a speed the supporting tooling did not anticipate. Frameworks for building agents (LangChain, LangGraph, AutoGen, CrewAI, Claude Code, OpenAI Assistants) matured rapidly. The frameworks for *governing* those agents — identity, credential management, audit, least-privilege enforcement — lagged behind.

The result is a generation of agentic systems that are powerful but fragile on the security and accountability dimensions:

- Most agent implementations pass raw API keys or tokens directly into the context window, where the model layer can log, replay, or leak them.
- Audit trails typically record what model was called, not *on whose behalf* and *with whose privilege*.
- Multi-agent orchestration (agent calling agent calling tool) creates anonymous action chains with no traceable principal at intermediate hops.
- Provider lock-in at the credential layer means changing from OpenAI to Anthropic requires re-engineering auth, not just swapping a model string.

`agent-identity` was built to close each of these gaps systematically.

### The regulatory environment is catching up

GDPR, SOC 2, ISO 27001, and emerging AI-specific frameworks (EU AI Act, NIST AI RMF) are beginning to ask the same questions about AI agents that they ask about human users: who acted, on whose behalf, with what authority, and is there a log? Organisations deploying agents in customer-facing, financial, or healthcare contexts will need to answer these questions in audits. A system where "the agent did it" is the only available answer will not pass.

### Multi-agent pipelines are becoming the default architecture

The shift from single-agent to multi-agent architectures (orchestrator → sub-agents → tool agents) is already well underway. In a pipeline of five agents, if each hop doesn't carry a traceable identity, the blast radius of any misconfiguration or compromise is the entire pipeline. The `agent-as-service` identity type in this framework directly addresses this: each agent in a pipeline has its own machine identity, every hop is tagged, and the full chain is reconstructible from the audit log.

### Provider diversity is here to stay

No single AI provider will dominate every use case. Cost, capability, latency, data-residency requirements, and compliance constraints mean most production systems already use or plan to use multiple providers. `agent-identity`'s `ProviderAdapter` interface normalises credential injection across OpenAI, Anthropic, Gemini, Mistral, and local models — your routing rules, audit logs, and identity configuration don't change when you change the model underneath.

---

## 🗄️ Data migration support — why it matters and how it works

Data migration is one of the highest-risk operations an AI agent can perform. It crosses credential boundaries, involves both reading from a live source and writing to a target, and produces a volume of actions that would individually appear routine but collectively can corrupt, leak, or irrecoverably lose data if the wrong credential is used at the wrong phase.

Most agent frameworks treat migration as just another batch of API calls. `agent-identity` treats it as a first-class operation with its own type system, routing semantics, audit trail, and safeguards.

### The core problem with migration credentials

A migration agent needs two fundamentally different credentials at different points in the same run:

| Phase | What it needs | What happens without explicit routing |
|---|---|---|
| `dry-run` | Read-only access to source only | Agent may silently write to target, defeating the dry-run |
| `extract` | Read-only access to source | A write-scoped credential here means over-privileged read |
| `transform` | No external credential | None needed — but a credential in scope is a liability |
| `load` | Write access to target only | A read-only credential fails at the DB, not at the router — late, expensive |
| `verify` | Read access to both source and target | Missing source cred means incomplete verification |
| `rollback` | Write access to target | Must be the same write credential as `load` |

Without phase-aware routing, the agent either holds one credential for everything (over-privileged) or makes ad-hoc decisions per call (unauditable and error-prone).

### What `agent-identity` adds for migration

**1. `MigrationContext` — a typed, phase-aware request context**

Extends `AgentRequestContext` with the fields a migration agent actually needs:

```typescript
const ctx: MigrationContext = {
  // standard agent fields
  userId: 'svc-migration-bot',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  traceId: 'trace-abc123',
  requestedAt: new Date().toISOString(),

  // migration-specific
  migrationId: 'migration-2026-q2-crm',   // ties every phase's audit entries together
  phase: 'load',
  sourceResourceId: 'crm-postgres-prod',
  targetResourceId: 'crm-postgres-v2',
  dryRun: false,
  batchIndex: 3,
  totalBatches: 12,

  // required by AgentRequestContext
  resourceId: 'crm-postgres-prod',
  resourceKind: 'shared',
  action: 'write',
};
```

Every routing rule, audit entry, and credential reservation is tied to this context. Nothing is ambiguous.

**2. Phase-aware routing rules**

Routing rules now match on `phase` and enforce `readOnly` at the router level — before any data moves:

```typescript
// Routing rules for a complete migration run:

{ id: 'migration-dryrun',   matchPhase: 'dry-run',            readOnly: true,  credentialRef: 'source-readonly-slot', priority: 60 },
{ id: 'migration-extract',  matchPhase: 'extract',            readOnly: true,  credentialRef: 'source-readonly-slot', priority: 60 },
{ id: 'migration-load',     matchPhase: ['load', 'rollback'],                  credentialRef: 'target-write-slot',    priority: 60 },
{ id: 'migration-verify',   matchPhase: 'verify',             readOnly: true,  credentialRef: 'source-readonly-slot', priority: 55 },
```

A `dry-run` rule with `readOnly: true` will be rejected by the router if the resolved credential's scope does not include `'read'`. The misconfiguration is caught at routing time, not at the database.

**3. `resolvePair()` — dual-credential resolution in one call**

The router's `resolvePair(ctx: MigrationContext)` method resolves both source and target credentials simultaneously:

```typescript
const router = createRouter(credentials, rules, logger);
const pair = router.resolvePair(ctx);

if (!pair) {
  throw new Error('Could not resolve source and target credentials for this migration phase.');
}

// pair.source → read-scoped credential for sourceResourceId
// pair.target → write-scoped credential for targetResourceId (or read if dryRun)
// pair.expiresAt → ISO 8601 earliest expiry of both — use this to know when to refresh
// pair.migrationId → tied to ctx.migrationId for the full audit trail
```

**4. `POST /api/migrate/resolve` — batch-friendly HTTP endpoint**

For migration agents that call the framework over HTTP, the dedicated endpoint resolves both credentials in one round-trip:

```bash
POST /api/migrate/resolve
Content-Type: application/json

{
  "migrationId": "migration-2026-q2-crm",
  "phase": "load",
  "sourceResourceId": "crm-postgres-prod",
  "targetResourceId": "crm-postgres-v2",
  "userId": "svc-migration-bot",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "traceId": "trace-abc123",
  "dryRun": false,
  "batchIndex": 0,
  "totalBatches": 12
}
```

Response (no secrets ever leave the server):

```json
{
  "migrationId": "migration-2026-q2-crm",
  "phase": "load",
  "sourceResolvedFor": "service",
  "targetResolvedFor": "service",
  "dryRun": false,
  "expiresAt": "2026-05-25T10:00:00.000Z"
}
```

The agent calls this once per phase, not once per row. For a migration of 100,000 rows, that is the difference between 100,001 auth round-trips and 6.

**5. `validateForMigration()` — catch scope mismatches before data moves**

Every provider adapter implements `validateForMigration(credential, phase)`. The check fires before any row is read or written:

```typescript
const adapter = getAdapter(ctx.provider);

// Throws immediately if a read-only credential ref is used in a load or rollback phase:
// "[anthropic] Migration phase "load" requires a write-scoped credential,
//  but credential ref "source-readonly-slot" appears to be read-only."
adapter.validateForMigration?.(resolved, ctx.phase);
```

**6. `reserve()` / `release()` — prevent concurrent migration corruption**

Credential stores support reservations. Call `reserve()` before the batch loop; call `release()` in the `finally` block:

```typescript
const store = new MemoryCredentialStore(credentials);
const reserved = await store.reserve('target-write-slot', ctx.migrationId, 7200); // 2-hour TTL

if (!reserved) {
  throw new Error('Target credential is already in use by another migration. Abort.');
}

try {
  // ... batch loop: extract → transform → load
} finally {
  await store.release('target-write-slot', ctx.migrationId);
}
```

**7. `MigrationAuditLogEntry` — groupable, summarisable audit trail**

All migration activity extends the base `AuditLogEntry` with migration-specific fields:

```typescript
interface MigrationAuditLogEntry extends AuditLogEntry {
  migrationId: string;       // group all phases of one run
  phase: MigrationPhase;     // which phase produced this entry
  rowsRead?: number;
  rowsWritten?: number;
  rowsFailed?: number;
  dryRun: boolean;
  sourceCredentialId: string;
  targetCredentialId: string;
  errorSummary?: string;
}
```

The `MigrationAuditLogger` interface adds `summarize(migrationId)` — call it after the run completes to get total row counts, phase coverage, and error roll-up across all audit entries for that migration ID.

**8. Migration tab in the UI**

The app's navigation includes a **Data migration** tab with a visual flow diagram, clickable phase timeline, configuration Q&A, and a copyable API quick-reference card.

### Why data migration is uniquely dangerous without this

Most credential misconfigurations in agentic systems are caught quickly — a wrong API key returns a 401, and the agent stops. Migration misconfigurations are different:

- **A dry-run with a write-capable credential silently writes.** The dry-run returns no errors, the team proceeds with confidence, and the production run is now a double-write.
- **A read-only credential on the load phase fails at the database layer, not the routing layer.** By the time the error surfaces, the agent may have processed thousands of rows and the rollback path is unclear.
- **Two concurrent migration jobs on the same write credential produce interleaved writes.** Neither job errors. The target dataset is silently corrupted.
- **A migration without a grouped audit trail is unreplayable.** Without `migrationId` threading every entry, reconstructing what failed requires correlating thousands of individual audit records by timestamp.

The migration enhancements in `agent-identity` close all four failure modes by design, not by convention.

---

## Auth patterns

| Pattern | Use when | Tradeoff |
|---|---|---|
| **Individual user auth** | Users have different access levels to the same resource | More credential management; each user needs a token provisioned |
| **Fixed credential** | All users are equal (shared task boards, wikis) | No per-user traceability at the credential level; supplement with audit logging |
| **Hybrid / context-switched** | Agent touches both shared and personal resources in one workflow | More complex routing logic; rules must be explicitly defined and tested |
| **Token exchange** | Agent must act as a specific user without storing per-user tokens long-term | Requires a token exchange endpoint; scope constraints must be strictly enforced |
| **Data migration** | Agent reads from one system and writes to another, across phases | Phase-aware routing rules required; use `resolvePair()` and `reserve()` for correctness |

---

## Security principles

- **Credentials are stored encrypted at rest** — the vault stores refs, not raw secrets
- **The model layer never receives raw credentials** — the router injects them at call time via the provider adapter
- **Every agent action is tagged with the resolved identity** — `userId`, `action`, `resource`, `credentialId`, `resolvedFor` written to the audit log on every routed request
- **Least-privilege by design** — user-delegated tokens are scoped to what that user already has; the agent cannot escalate
- **No credential escalation path** — the routing engine has no mechanism to elevate a user-delegated token beyond its original scope
- **Migration dry-runs are enforced read-only at the router** — `readOnly: true` on a routing rule rejects credentials that lack read scope before any call is made
- **Concurrent migration corruption is prevented by design** — `reserve()` locks a write credential to one migration ID for the duration of the batch; a second job receives `false` and must abort, not proceed

---

## Core concepts

### Identity types

- **User-delegated** — agent uses each user's own OAuth token or API key; enforces per-user entitlements
- **Fixed service** — agent uses a single shared service account; right for shared, equal-access resources
- **Hybrid** — agent selects the right credential per task within one workflow
- **Agent-as-service** — agent has its own machine identity; essential for multi-agent pipelines where agents call agents

### Credential routing

The routing engine (`packages/core/src/router.ts`) inspects each outbound call and selects the correct credential based on:
- Target resource type (`shared` vs `personal`)
- Calling user's identity context
- Migration phase (when `MigrationContext` is provided)
- Configured `RoutingRule[]`

The model layer **never** sees raw credentials. The router injects them at call time via the provider adapter, and writes an audit entry tagging `userId`, `action`, `resource`, `credentialId`, and `resolvedFor`.

### Provider adapters

Adapters in `packages/core/src/providers.ts` normalise credential injection across providers. Add a new provider by implementing the `ProviderAdapter` interface — your routing rules and audit configuration are untouched. All adapters also implement `validateForMigration()` to catch scope mismatches before data moves.

---

## Adding a routing rule

```typescript
import type { RoutingRule } from '@datacules/agent-identity';

// Standard rule — single credential, any phase
const rule: RoutingRule = {
  id: 'rule-personal-docs',
  resourceKind: 'personal',         // 'shared' | 'personal'
  credentialKind: 'user-delegated', // 'fixed' | 'user-delegated'
  credentialRef: 'user-oauth-ref',  // opaque slot identifier — never a raw secret
  description: "Use the calling user's own token for personal document access.",
  priority: 10,
};

// Migration rule — phase-aware, read-only enforced
const migrationExtractRule: RoutingRule = {
  id: 'migration-extract',
  description: 'Read-only source credential for extract phase',
  matchPhase: 'extract',
  readOnly: true,
  credentialRef: 'source-readonly-slot',
  credentialKind: 'fixed',
  priority: 60,
};
```

The router matches on `resourceKind`, `phase`, `provider`, `userId`, and `action` — resolves the credential ref server-side, injects it via the provider adapter, and writes the audit entry. The model never sees the credential.

---

## Project structure

```
agent-identity/
├── packages/
│   ├── core/                           # @datacules/agent-identity (publishable npm package)
│   │   └── src/
│   │       ├── types.ts                # Core type definitions
│   │       ├── router.ts               # Credential routing engine
│   │       ├── providers.ts            # AI provider adapters
│   │       ├── decision.ts             # Decision helper logic
│   │       ├── schemas.ts              # Zod schemas (validation + OpenAPI generation)
│   │       ├── credentials.ts          # Default credentials (dev/demo)
│   │       └── react/
│   │           └── useAgentIdentity.ts # Production-safe React hook
│   ├── audit/                          # @datacules/agent-identity-audit
│   │   └── src/                        # Console, Webhook, Datadog, Splunk, Composite sinks
│   ├── stores/
│   │   ├── aws/                        # @datacules/agent-identity-store-aws
│   │   └── vault/                      # @datacules/agent-identity-store-vault
│   └── integrations/
│       ├── langchain/                  # @datacules/agent-identity-langchain
│       ├── express/                    # @datacules/agent-identity-express
│       └── fastify/                    # @datacules/agent-identity-fastify
├── src/                                # Next.js dashboard app
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── resolve/route.ts        # POST /api/resolve
│   │       └── migrate/resolve/route.ts # POST /api/migrate/resolve
│   ├── components/
│   │   ├── FlowDiagram.tsx
│   │   ├── IdentitiesTab.tsx
│   │   ├── PatternsTab.tsx
│   │   ├── CredentialsTab.tsx
│   │   ├── DecisionTab.tsx
│   │   └── MigrationTab.tsx
│   ├── lib/                            # App-layer wrappers (re-export from packages/core)
│   └── hooks/
│       ├── useIdentity.ts
│       ├── useCredentials.ts
│       └── useRouter.ts
├── docs/
│   ├── openapi.yaml                    # OpenAPI 3.1 spec for /api/resolve + /api/migrate/resolve
│   ├── patterns.md
│   ├── credential-routing.md
│   └── provider-integration.md
├── examples/
│   ├── openai-user-delegated/
│   ├── anthropic-fixed-cred/
│   └── hybrid-routing/
├── packages/python-sdk/                # pip install agent-identity
├── Dockerfile
├── docker-compose.yml
├── package.json                        # Monorepo root (npm workspaces + turbo)
├── tsconfig.json
└── next.config.js
```

---

## Supported providers

| Provider | Adapter | `validateForMigration` | Example |
|---|---|---|---|
| OpenAI | `openai` | ✓ | `examples/openai-user-delegated/` |
| Anthropic | `anthropic` | ✓ | `examples/anthropic-fixed-cred/` |
| Gemini | `gemini` | ✓ | — |
| Mistral | `mistral` | ✓ | — |
| Local models | `local` | ✓ | `examples/hybrid-routing/` |

Implement `ProviderAdapter` to add any provider in minutes.

---

## Star it. Fork it. Tell us what pattern you're missing.

Built at **Datacules LLC** 🤖 — [datacules.com](https://datacules.com)

`#AIAgents` `#OpenSource` `#AgentIdentity` `#LLMSecurity` `#MultiAgentSystems` `#AIEngineering` `#FutureOfAI` `#DevSecOps` `#Accountability` `#TrustInAI` `#DataMigration`

---

## License

Copyright © 2026 Datacules LLC. Released under the [Datacules Open Source License](LICENSE) — permissive, commercial-friendly, no copyleft requirement.
