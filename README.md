<p align="center">
  <img src="assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="520"/>
</p>

<p align="center">
  <strong>Agent Identity &amp; Auth Patterns</strong><br/>
  <sub>A provider-agnostic framework by <a href="https://datacules.com">Datacules LLC</a></sub>
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Datacules%20Open%20Source-black?style=flat-square" alt="License"/>
  </a>
  <a href="https://github.com/hvrcharon1/agent-identity/stargazers">
    <img src="https://img.shields.io/github/stars/hvrcharon1/agent-identity?style=flat-square&color=black" alt="Stars"/>
  </a>
  <a href="https://github.com/hvrcharon1/agent-identity/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/hvrcharon1/agent-identity/ci.yml?branch=main&style=flat-square&label=CI&color=black" alt="CI"/>
  </a>
  <img src="https://img.shields.io/badge/version-0.9.0-black?style=flat-square" alt="Version"/>
  <img src="https://img.shields.io/badge/packages-21%20(npm%20%2B%20PyPI)-black?style=flat-square" alt="Packages"/>
  <img src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Mistral%20%7C%20Local-black?style=flat-square" alt="Supported providers"/>
  <img src="https://img.shields.io/badge/MCP-server%20%2B%20client-black?style=flat-square" alt="MCP support"/>
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
> ...That's all the trail you have.

**This is the identity gap in agentic AI — and it's sitting quietly inside most production agent systems right now.**

When an AI agent acts on behalf of a user, it needs to know three things:

- **Whose identity am I carrying?**
- **Which credential is appropriate for this specific resource?**
- **Can I be audited, traced, and held accountable for this action?**

Without explicit answers, you get silent privilege escalation, raw credentials in context windows, and action chains that are completely anonymous across multi-agent pipelines.

So we built something to solve it: **`agent-identity`** — open-source, provider-agnostic, built for production.

---

## The Nine Foundational Pillars

`agent-identity` is built on nine principles that define not just what the framework does, but what it will never compromise. These are the architectural decisions made before the first line of code was written — the frame that every feature, integration, and interface is built around.

---

### I · Identity Sovereignty

> *The agent is not the principal. Every agentic action belongs to a traceable human identity.*

An agent's identity is delegated, not inherent. When an agent modifies a file, sends an email, or calls a downstream API, those actions belong to a user, a service account, or a defined machine identity with a declared origin. `agent-identity` makes this delegation explicit and load-bearing at the routing layer: `resolvedFor` on every `ResolvedCredential` is the contractual answer to "who authorised this action." In multi-agent pipelines, each hop carries its own `IdentityChainEntry` — org, userId, agentId, issuedAt, Ed25519 signature — so the complete delegation path is always reconstructible, not just the first and last link.

The principle: no agent action may be anonymous. Identity is the first contract, not an optional annotation.

---

### II · Zero Credential Exposure

> *Raw secrets do not belong in context windows, agent state, or framework logs. They are delivered once, server-side, at the last responsible moment.*

API keys, OAuth tokens, and database passwords that enter a context window can be logged, replayed, or leaked by the model layer itself. The router returns opaque `ref` strings throughout the system — actual secrets are fetched server-side by provider adapters at injection time, never before. Three credential delivery mechanisms extend this principle to different trust domains:

- **SPIFFE/SPIRE** — X.509 SVIDs cryptographically attested by a SPIRE agent; no static secrets exist anywhere in the system
- **JIT provisioning** — Vault, AWS IAM Roles Anywhere, or Azure Managed Identity mint short-lived credentials on demand, TTL-bounded and auto-revoked
- **RFC 8693 token exchange** — user access tokens are exchanged for scoped downstream tokens at request time, cached briefly with a 30-second expiry buffer, never stored long-term

The model layer never holds what it doesn't need to hold.

---

### III · Least Privilege by Construction

> *Agents cannot escalate beyond the calling user's existing entitlements. This is enforced by the routing engine, not by convention.*

User-delegated credentials are scoped to what the calling user already holds. The routing engine has no mechanism to elevate them. Least-privilege is structural, not a checklist item.

Three enforcement points implement this principle:

1. `readOnly: true` on a routing rule rejects write-scoped credentials at the router — before any call reaches the downstream system, before any data moves
2. `validateForMigration()` on every provider adapter enforces scope-phase alignment: read-only credentials in extract/dry-run phases, write-scoped credentials in load/rollback phases — mismatches surface as routing errors, not database errors
3. `CredentialStatus` lifecycle (`pending` → `unclaimed` → `active` → `revoked`) prevents credentials from resolving until they have completed their provisioning or claim ceremony — `unclaimed` credentials (auth.md pre-claim) are never routable

Misconfiguration is caught at the layer closest to the decision, not at the layer closest to the consequence.

---

### IV · Full Reconstructibility

> *Every action in every agent pipeline — including multi-hop, multi-agent chains — must be fully reconstructible from the audit log.*

"The agent did it" is not an audit entry. Every resolution records `userId`, `action`, `resourceId`, `credentialId`, `resolvedFor`, `traceId`, `provider`, `model`, `credentialKind`, and optionally `spiffeId` and `identityChain`. This is not telemetry — it is the legal and operational record.

Four mechanisms harden the audit trail beyond simple logging:

1. **`HashChainAuditLogger`** links every entry with a SHA-256 hash of the previous entry, producing a tamper-evident chain that can be verified offline
2. **`ComplianceReportGenerator`** distils audit log stores into SOC 2, GDPR, and HIPAA reports with structured sections: `agentAccessSummary`, `piiResourceAccess`, `offHoursAccess`, `credentialRotationHistory`, `anomalyEvents`
3. **`MigrationAuditLogEntry`** extends the base entry with `migrationId`, `phase`, `rowsRead`, `rowsWritten`, `rowsFailed`, and `errorSummary` — migrations produce roll-up summaries, not just raw events
4. **`audit verify` CLI command** checks chain integrity offline, before a SOC 2 package is submitted

In a five-agent orchestration pipeline, every hop is in the log. Not summarised. Not sampled. Every hop.

---

### V · Provider Independence

> *Governance infrastructure — credential routing, audit trails, approval gates, compliance reports — must survive a provider swap without modification.*

No single AI provider will serve every use case. Cost, capability, latency, data-residency requirements, and compliance constraints mean production systems already use or plan to use multiple models. `agent-identity`'s `ProviderAdapter` interface is the isolation boundary between model choice and governance architecture.

Routing rules, credential stores, approval gates, anomaly detection, compliance reports, and audit sinks are identical whether the model underneath is OpenAI GPT-4o, Anthropic Claude, Gemini, Mistral, or a self-hosted local model. Changing providers is a one-line adapter switch. The `ProviderAdapter` interface has two responsibilities: normalise credential injection (`injectCredential`) and enforce migration scope alignment (`validateForMigration`). Everything else is untouched.

The governance layer you build today does not need to be rebuilt when the model landscape changes tomorrow.

---

### VI · Human Authority Preserved

> *Automation extends human intent. It does not override it. The system is designed to keep humans in control at the points that matter most.*

Three mechanisms implement this principle:

**Approval gates** — `ApprovalPolicy` on any routing rule puts a human decision-maker in the resolution path before high-risk credentials can be used. Approvers are notified via webhook, email, or Slack. The resolution blocks until the required number of approvers respond. Break-glass overrides exist — they require justification, are audited with full context, and are reconstructible from the log.

**Budget enforcement** — `BudgetPolicy` on any credential defines hard ceilings: maximum resolutions per hour, maximum concurrent sessions, maximum daily spend in USD, configurable soft-threshold warnings. The `BudgetEnforcer` checks these before any credential resolves. Agents cannot exhaust resources without the system emitting warnings and eventually blocking.

**Anomaly detection** — `withAnomalyDetection()` wraps the audit pipeline with an EWMA behavioral baseline. Detected signals — new credential type, 3× call-rate spike, off-hours access, new resource kind — trigger configurable response policies: `warn`, `throttle`, or `block`. The system escalates without requiring human polling.

The principle: automation should make agents faster, not ungovernable.

---

### VII · Phase Awareness for Stateful Operations

> *Multi-step workflows require credential semantics that match each phase. A single token for everything is an architectural category error.*

Data migration is the canonical case. A migration agent needs read-only source access during extract, no external credential during transform, write-only target access during load, read access to both during verify, and the same write credential as load during rollback. Mixing these is not just a security risk — it is a data integrity risk. Giving the agent one credential for the entire run is over-privileged; making ad-hoc decisions per call is unauditable.

`agent-identity` treats phase as a first-class routing dimension:

- **`MigrationContext`** — extends `AgentRequestContext` with `phase`, `sourceResourceId`, `targetResourceId`, `migrationId`, `dryRun`, `batchIndex`, `totalBatches`
- **`matchPhase` routing rules** — phase-aware rule matching routes each step of a migration to the right credential by construction, not by convention
- **`resolvePair()`** / **`resolvePairAsync()`** — resolve source and target credentials in one call, with the source always using action `read` and the target using action `read` when `dryRun: true`
- **`reserve()`** / **`release()`** — lock a write credential to one `migrationId` for the duration of the batch; a second concurrent job receives `false` immediately and must abort before any data moves
- **`validateForMigration()`** — enforced at the provider adapter layer; catches scope mismatches before the first write, not after

The same phase-aware model applies to any stateful multi-step workflow — not just migration. If your operation has stages, your credentials should too.

---

### VIII · Composable by Interface

> *Every capability is an interface contract with one or more concrete implementations. Nothing is load-bearing by vendor choice.*

`agent-identity` is a collection of small, well-defined interfaces with multiple implementations:

| Interface | Development default | Production options |
|---|---|---|
| `CredentialStore` | `MemoryCredentialStore` | AWS, Vault, Azure, SPIFFE, LibSQL, auth.md, MCP-backed |
| `AuditLogger` | `ConsoleAuditLogger` | Datadog, Splunk, Webhook, Composite fan-out, HashChain |
| `ProviderAdapter` | All five built-in | Implement `ProviderAdapter` to add any provider |
| `AttestationSigner` | `HmacAttestationSigner` | `AsymmetricAttestationSigner` (RS256/ES256), custom |
| `ApprovalManager` | `MemoryApprovalStore` | Extend with any webhook/email/Slack integration |
| `BudgetEnforcer` | `MemoryBudgetStore` | `LibSqlBudgetStore`, custom |

Any layer can be swapped without touching any other. Build a custom `CredentialStore` against your own secrets backend in under 50 lines — implement `findByRef`, `listActive`, `listByKind`, and optionally `reserve`/`release` for migration safety. The rest of the framework does not notice.

This composability is what makes the framework production-grade across organisations of different scale, different cloud providers, and different compliance requirements — without a configuration explosion.

---

### IX · Standards-Anchored

> *Every integration point aligns with an open standard where one exists. The framework is a compliant participant in ecosystems that are already forming, not a competing alternative to them.*

`agent-identity` adopts existing standards at every layer rather than inventing proprietary protocols:

| Capability | Standard |
|---|---|
| OAuth token delegation | RFC 8693 — OAuth 2.0 Token Exchange |
| Workload identity | SPIFFE/SPIRE — Secure Production Identity Framework For Everyone |
| Distributed tracing | OpenTelemetry — spans nest inside existing Datadog, Honeycomb, Jaeger, X-Ray traces |
| AI agent identity registration | auth.md + ID-JAG draft spec — standardised agent registration and claim ceremony |
| Identity revocation | OAuth 2.0 / OIDC `logout+jwt` — inbound revocation with jti replay protection |
| Attestation signing | HMAC-SHA256, RS256, ES256 via Web Crypto API — no external crypto libraries |
| Workload attestation | X.509 SVIDs (SPIFFE) — short-lived certificates, auto-renewed by SPIRE agent |
| API schema validation | Zod + JSON Schema — runtime validation, OpenAPI spec generation, Python Pydantic interop |

These standards predate `agent-identity` and will outlast any specific implementation. When the regulatory environment catches up to agentic AI — and it is catching up — the systems built on these standards will already speak the same language as auditors, compliance frameworks, and identity providers.

---

> **AI agents are executing real actions — merging code, modifying databases, sending emails, calling APIs on behalf of real people. The question of *who* the agent is acting as, and *with which credentials*, is no longer academic. It is a production-grade engineering concern.**

A provider-agnostic framework for AI agents that act on behalf of users and services — with precise, auditable credential routing. Works with OpenAI, Anthropic, Gemini, Mistral, and local models out of the box.

---

## Packages

| Package | Install | Description |
|---------|---------|-------------|
| `@datacules/agent-identity` | `npm install @datacules/agent-identity` | Core router, types, Zod schemas, React hook |
| `@datacules/agent-identity-audit` | `npm install @datacules/agent-identity-audit` | Console, Webhook, Datadog, Splunk, Composite audit sinks |
| `@datacules/agent-identity-store-aws` | `npm install @datacules/agent-identity-store-aws` | AWS Secrets Manager + DynamoDB credential store |
| `@datacules/agent-identity-store-vault` | `npm install @datacules/agent-identity-store-vault` | HashiCorp Vault KV v2 credential store |
| `@datacules/agent-identity-store-azure` | `npm install @datacules/agent-identity-store-azure` | Azure Key Vault + Table Storage credential store |
| `@datacules/agent-identity-store-spiffe` | `npm install @datacules/agent-identity-store-spiffe` | SPIFFE/SPIRE workload identity via X.509 SVIDs — zero static credentials |
| `@datacules/agent-identity-store-dynamic` | `npm install @datacules/agent-identity-store-dynamic` | JIT credential provisioning — Vault dynamic secrets, AWS IAM Roles Anywhere, Azure Managed Identity |
| `@datacules/agent-identity-store-authmd` | `npm install @datacules/agent-identity-store-authmd` | auth.md registration CredentialStore — ID-JAG, verified-email, and anonymous OTP claim ceremony; inbound `logout+jwt` revocation |
| `@datacules/agent-identity-store-libsql` | `npm install @datacules/agent-identity-store-libsql` | LibSQL (SQLite / Turso) persistence — `CredentialStore`, `ApprovalStore`, `BudgetStore`, `AuditLogger`; embedded SQLite or globally distributed Turso via one connection string |
| `@datacules/agent-identity-express` | `npm install @datacules/agent-identity-express` | Express middleware |
| `@datacules/agent-identity-fastify` | `npm install @datacules/agent-identity-fastify` | Fastify plugin |
| `@datacules/agent-identity-langchain` | `npm install @datacules/agent-identity-langchain` | LangChain tool + LangGraph node |
| `@datacules/agent-identity-nestjs` | `npm install @datacules/agent-identity-nestjs` | NestJS module, service, guard, and parameter decorator |
| `@datacules/agent-identity-mcp` | `npm install @datacules/agent-identity-mcp` | MCP server — expose agent-identity tools to any MCP client |
| `@datacules/agent-identity-mcp-client` | `npm install @datacules/agent-identity-mcp-client` | MCP client — fetch credentials from any MCP server |
| `@datacules/agent-identity-otel` | `npm install @datacules/agent-identity-otel` | OpenTelemetry tracing — `withOtel()` wraps any router, emits spans on every `resolve()` |
| `@datacules/agent-identity-anomaly` | `npm install @datacules/agent-identity-anomaly` | Behavioral baseline anomaly detection with EWMA scoring and configurable response policies |
| `@datacules/agent-identity-compliance` | `npm install @datacules/agent-identity-compliance` | Compliance report generator — SOC 2, GDPR, HIPAA templates from audit log store |
| `@datacules/agent-identity-token-exchange` | `npm install @datacules/agent-identity-token-exchange` | RFC 8693 OAuth 2.0 Token Exchange CredentialStore — exchanges user access tokens for scoped downstream tokens at any OAuth 2.0 AS (Keycloak, Auth0, Azure AD, Okta) |
| `@datacules/agent-identity-cli` | `npm install @datacules/agent-identity-cli` | CLI — `audit verify` chain integrity · `report soc2/gdpr/hipaa` · `health` · `resolve` |
| `datacules-agent-identity` (PyPI) | `pip install datacules-agent-identity` | Python SDK — sync + async client, zero runtime deps, CLI |

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

### OpenTelemetry tracing

```bash
npm install @datacules/agent-identity-otel
```

```typescript
import { withOtel } from '@datacules/agent-identity-otel';
import { trace } from '@opentelemetry/api';

const router = withOtel(createRouter(credentials, rules, logger), {
  tracer: trace.getTracer('agent-identity'),
});
// Every resolve(), resolveAsync(), and resolvePair() call now emits spans
// that nest inside your existing application traces in Datadog, Honeycomb, Jaeger, or X-Ray.
```

---

### Anomaly detection

```bash
npm install @datacules/agent-identity-anomaly
```

Wraps the audit pipeline with an EWMA-based behavioral baseline. Builds a rolling profile per agent ID and scores each new resolution against it. Configurable response policies:

```typescript
import { withAnomalyDetection } from '@datacules/agent-identity-anomaly';

const router = withAnomalyDetection(createRouter(credentials, rules, logger), {
  policies: [
    { severity: 'low',    action: 'warn' },     // emit credential.anomaly audit event
    { severity: 'medium', action: 'throttle' }, // rate-limit to 10% of normal
    { severity: 'high',   action: 'block' },    // return null pending human review
  ],
});
```

Detected signals: new credential type, call-rate spike (3× EWMA), new action type, off-hours access, new resource kind.

---

### Compliance reports

```bash
npm install @datacules/agent-identity-compliance
```

```typescript
import { ComplianceReportGenerator, MemoryReportStore } from '@datacules/agent-identity-compliance';

const generator = new ComplianceReportGenerator({ store });

const report = await generator.generate({
  type: 'soc2',         // 'soc2' | 'gdpr' | 'hipaa' | 'custom'
  from: '2026-01-01T00:00:00Z',
  to:   '2026-03-31T23:59:59Z',
  format: 'markdown',   // 'json' | 'markdown'
});
// report.agentAccessSummary, .piiResourceAccess, .offHoursAccess,
// .credentialRotationHistory, .anomalyEvents
```

---

### CLI

```bash
npm install -g @datacules/agent-identity-cli
```

```bash
# Verify audit chain integrity before submitting a SOC 2 package
agent-identity-cli audit verify --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31

# Generate a HIPAA compliance report
agent-identity-cli report hipaa --file ./audit.jsonl --output ./compliance-reports/

# Test routing rules against the running server
agent-identity-cli resolve --provider anthropic --user user-abc

# Liveness check
agent-identity-cli health
```

See [`packages/cli/README.md`](packages/cli/README.md) for the full command reference.

---

### RFC 8693 Token Exchange

```bash
npm install @datacules/agent-identity-token-exchange
```

`TokenExchangeStore` implements `CredentialStore`. On `findByRef()` it POSTs a standard RFC 8693 token exchange request to any OAuth 2.0 Authorization Server (Keycloak, Auth0, Azure AD, Okta) and caches the returned access token with a 30-second expiry buffer. No long-term user token storage required.

```typescript
import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new TokenExchangeStore([
  {
    ref: 'crm-service',
    credentialId: 'crm-delegated',
    kind: 'user-delegated',
    scope: 'crm.read crm.write',
    status: 'active',
    tokenEndpoint: 'https://auth.acme.com/realms/prod/protocol/openid-connect/token',
    clientId: process.env.CRM_CLIENT_ID!,
    clientSecret: process.env.CRM_CLIENT_SECRET!,
    audience: 'crm-api',
    // Provide the current user's access/ID token as a closure over request context
    subjectTokenProvider: async () => getUserAccessToken(req),
  },
]);

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
// resolved.ref IS the exchanged downstream access_token — injected server-side by the provider adapter
```

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

The middleware reads `req.body.agentContext` (configurable via `contextKey`) and attaches the resolved credential to `req.resolvedCredential`. Requires `express.json()` to be registered before the middleware.

```typescript
import express from 'express';
import { agentIdentityMiddleware } from '@datacules/agent-identity-express';

const app = express();
app.use(express.json());

app.use('/ai', agentIdentityMiddleware({ credentials, rules, logger }));

app.post('/ai/complete', (req, res) => {
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

### NestJS

```bash
npm install @datacules/agent-identity-nestjs @datacules/agent-identity
```

#### Module registration

```typescript
// Synchronous
@Module({
  imports: [
    AgentIdentityModule.forRoot({ credentials, rules, logger }),
  ],
})
export class AppModule {}

// Asynchronous — pull from ConfigService or any other provider
@Module({
  imports: [
    AgentIdentityModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        credentials: cfg.get('AI_CREDENTIALS'),
        rules:       cfg.get('ROUTING_RULES'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

#### Guard + parameter decorator

```typescript
import { AgentIdentityGuard, ResolvedCredential } from '@datacules/agent-identity-nestjs';
import type { ResolvedCredential as Cred } from '@datacules/agent-identity';

@Post('complete')
@UseGuards(AgentIdentityGuard)
async complete(@ResolvedCredential() cred: Cred) {
  // Guard resolved the credential before the handler ran.
  // cred.ref → fetch raw secret from your vault here, server-side only.
  return { resolvedFor: cred.resolvedFor };
}
```

The guard reads `request.body.agentContext` by default. Override `extractContext()` to read from a header or JWT instead.

#### Service (direct injection)

```typescript
@Injectable()
export class AiService {
  constructor(private readonly agentIdentity: AgentIdentityService) {}

  async complete(ctx: AgentRequestContext) {
    const resolved = await this.agentIdentity.resolveAsync(ctx);
    if (!resolved) throw new ForbiddenException('No credential matched');
    // use resolved.ref to fetch the raw secret from your vault
  }

  async migrate(ctx: MigrationContext) {
    const pair = await this.agentIdentity.resolvePairAsync(ctx);
    // pair.source, pair.target
  }
}
```

---

### LangChain / LangGraph

```bash
npm install @datacules/agent-identity-langchain
```

```typescript
import { createAgentIdentityModel } from '@datacules/agent-identity-langchain';

const { getModel, resolved } = createAgentIdentityModel(ctx, {
  credentials,
  rules,
  fetchSecret, // (ref: string) => Promise<string> — your vault call, server-side only
  logger,
});

const model = await getModel(); // ChatAnthropic / ChatOpenAI — API key injected server-side
const response = await model.invoke('Summarise this document.');
```

For LangGraph, use `createAgentIdentityNode()` as a drop-in `StateGraph` node that resolves and attaches `resolvedCredential` to graph state before any LLM call. The node reads `state.agentContext` and writes `state.resolvedCredential`.

---

### MCP server — inbound (`@datacules/agent-identity-mcp`)

Exposes agent-identity credential resolution as a **Model Context Protocol (MCP) server**. Any MCP-capable client — Claude Desktop, Claude Code, Cursor, Windsurf, or a custom agent — can call agent-identity tools directly over MCP without touching the HTTP REST API.

```bash
npm install @datacules/agent-identity-mcp
```

#### Tools registered

| Tool | Description |
|------|-------------|
| `resolve_credential` | Resolve a credential for an `AgentRequestContext` |
| `resolve_migration_credential` | Resolve source + target pair for a `MigrationContext` |
| `list_credentials` | List active credentials (safe metadata — no raw refs or secrets) |
| `list_rules` | List routing rules ordered by priority |
| `health` | Liveness check + loaded credential/rule counts |

#### Claude Desktop config

```json
{
  "mcpServers": {
    "agent-identity": {
      "command": "npx",
      "args": ["@datacules/agent-identity-mcp"],
      "env": {
        "AGENT_IDENTITY_CREDENTIALS": "<base64-encoded credentials JSON>",
        "AGENT_IDENTITY_RULES": "<base64-encoded rules JSON>"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add agent-identity \
  -e AGENT_IDENTITY_CREDENTIALS=<base64> \
  -e AGENT_IDENTITY_RULES=<base64> \
  -- npx @datacules/agent-identity-mcp
```

#### Programmatic (library mode)

```typescript
import { createAgentIdentityMcpServer } from '@datacules/agent-identity-mcp';

// stdio transport (Claude Desktop / Claude Code)
const { start } = createAgentIdentityMcpServer({ credentials, rules });
await start();

// HTTP+SSE transport (hosted / networked deployments)
const { start } = createAgentIdentityMcpServer({
  credentials, rules, transport: 'http', httpPort: 3002,
});
await start();
```

---

### MCP client — outbound (`@datacules/agent-identity-mcp-client`)

Lets agent-identity **consume** external MCP servers to fetch credentials. `McpCredentialStore` implements the existing `CredentialStore` interface — plug it straight into `createRouterFromStore()` with no other changes.

```bash
npm install @datacules/agent-identity-mcp-client
```

```typescript
import { McpCredentialStore } from '@datacules/agent-identity-mcp-client';
import { createRouterFromStore } from '@datacules/agent-identity';

// HTTP+SSE — connect to a running MCP server
const store = new McpCredentialStore({
  transport: 'http',
  serverUrl: 'http://localhost:3002',
});

// stdio — spawn a local MCP server process
const store = new McpCredentialStore({
  transport: 'stdio',
  command: 'npx',
  args: ['@datacules/agent-identity-mcp'],
  env: { AGENT_IDENTITY_CREDENTIALS: '...', AGENT_IDENTITY_RULES: '...' },
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```

`McpToolCaller` gives you typed direct access without a local router:

```typescript
import { McpToolCaller } from '@datacules/agent-identity-mcp-client';

const caller = new McpToolCaller({ transport: 'http', serverUrl: 'http://localhost:3002' });

const resolved = await caller.resolveCredential(ctx);
const pair     = await caller.resolveMigrationCredential(migCtx);
const alive    = await caller.health();
const rules    = await caller.callTool('list_rules', {}); // generic escape hatch
```

Both `McpCredentialStore` and `McpToolCaller` support `http` and `stdio` transports and share the same lazy-connect + in-memory cache pattern.

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
pip install datacules-agent-identity
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

Zero runtime dependencies. Fully typed with `TypedDict`. Raises `ValidationError` (400) or `NoCredentialError` (403) for clean error handling. Works with LangChain, AutoGen, CrewAI, or any Python agent framework.

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

// Azure Key Vault + Table Storage reservation locks
import { AzureKeyVaultCredentialStore } from '@datacules/agent-identity-store-azure';
const store = new AzureKeyVaultCredentialStore({
  keyVaultUrl:     'https://my-vault.vault.azure.net',
  tablesEndpoint:  'https://myaccount.table.core.windows.net',
});
const router = createRouterFromStore(store, rules, logger);

// SPIFFE/SPIRE — zero static credentials; X.509 SVIDs auto-renewed from SPIRE agent
import { SpiffeCredentialStore } from '@datacules/agent-identity-store-spiffe';
const store = new SpiffeCredentialStore({
  spiffeEndpointSocket: 'unix:///run/spire/sockets/agent.sock',
  trustDomain: 'acme.com',
});
const router = createRouterFromStore(store, rules, logger);

// LibSQL — embedded SQLite for local dev, globally distributed Turso for prod
// One connection string change; zero code changes between environments
import { createLibSqlStores } from '@datacules/agent-identity-store-libsql';

// Embedded (zero server — local file)
const { credentialStore } = await createLibSqlStores('file:./agent-identity.db');

// Globally distributed (Turso — swap the URL, nothing else changes)
const { credentialStore, approvalStore, budgetStore, auditLogger } = await createLibSqlStores(
  'libsql://your-db.turso.io',
  { authToken: process.env.TURSO_TOKEN! }
);
const router = createRouterFromStore(credentialStore, rules, auditLogger);

// auth.md — standardised AI agent identity registration via ID-JAG, verified-email, or anonymous OTP
// Agents register once; no static API keys stored anywhere
import { AgentAuthMdStore } from '@datacules/agent-identity-store-authmd';
const store = new AgentAuthMdStore({
  registrationEndpoint: 'https://auth.your-service.com/agents',
  trustedProviders: [
    { issuerUrl: 'https://api.openai.com', label: 'OpenAI' },
    { issuerUrl: 'https://claude.ai',      label: 'Anthropic' },
  ],
});
const router = createRouterFromStore(store, rules, logger);
// Inbound logout+jwt revocation is handled automatically — no extra wiring required
```

All stores implement the same `CredentialStore` interface and are drop-in replacements for each other.

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
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seventeen interactive tabs:

| Tab | Description |
|-----|-------------|
| Identities | Four identity types with descriptions and flow diagrams |
| Auth Patterns | Four auth patterns with tradeoff analysis and provider injection notes |
| Credentials | Credential vault with status badges, expiry warnings, rotation metadata |
| Decision Helper | Wizard — three yes/no questions → recommended auth pattern |
| Data Migration | Phase timeline, configuration Q&A, copyable API quick-reference |
| Attestation | Sign and verify JWT attestation tokens; decoded payload inspector |
| Canary Routing | Configure canary weight splits; simulate traffic; visualise distribution |
| Approval | Human-in-the-loop approval queue; break-glass override with justification |
| Budget | Per-credential usage bars with soft threshold markers; resolution simulator |
| Federation | Cross-org identity chain builder, trust domain registry, chain verifier |
| Anomaly | Live agent baseline table; anomaly event feed with severity badges; EWMA policy simulator |
| Token exchange | RFC 8693 OAuth token exchange — interactive `findByRef()` simulator, cache state UI, AS switcher (Keycloak / Auth0 / Azure AD / Okta), generated TypeScript snippet |
| Rotation | `CredentialRotationScheduler` demo — rotation-age progress bars, `runOnce()` simulator, audit event reference |
| OTEL tracing | Live span emitter — `withOtel()` wrapper; span schema, attribute grid, backend compatibility |
| JIT provisioning | `DynamicCredentialStore` demo — provisioner selector (Vault / AWS / Azure), TTL countdown, cache-state flow |
| SPIFFE / SPIRE | `SpiffeCredentialStore` demo — trust domain registry, SVID certificate panel, `matchSpiffeId` rule matcher |
| Compliance | `ComplianceReportGenerator` + `HashChainAuditLogger` — SOC 2 / GDPR / HIPAA report generator, hash chain visualizer, CLI reference |

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
User 1 ─┬
User 2 ──▶  [ AI Agent ]  ──▶  Fixed Auth  ──▶  Shared task board
User 3 ─┘                                        (all users have same access)
```

One agent, one shared credential, one downstream resource. All users are equal. Perfect for shared tools — task boards, internal wikis, analytics dashboards. Zero per-user complexity.

Simple and low-overhead, but supplement with request-level audit logging since the credential itself carries no per-user signal.

### 🟢 Pattern 2 — Individual user auth (variable access)

```
User 1 ──[ User 1 Auth ]─┬
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
- 🤝 **Works as both an MCP server and an MCP client** — integrates with the full MCP ecosystem in both directions
- 🗄️ **Supports safe, auditable data migration with phase-aware credential routing**
- 📊 **Emits OpenTelemetry spans** on every resolution — auth spans nest inside your existing application traces in Datadog, Honeycomb, Jaeger, or X-Ray.
- 🛡️ **Detects anomalous credential usage** with EWMA behavioral baselines
- 📄 **Generates SOC 2, GDPR, and HIPAA compliance reports** from audit log stores
- 🔄 **RFC 8693 OAuth token exchange** — exchange user access tokens for scoped downstream tokens at any OAuth 2.0 AS; no long-term token storage required
- 🔐 **JIT credential provisioning** — mint short-lived secrets on demand via Vault, AWS IAM Roles Anywhere, or Azure Managed Identity; zero static secrets at rest
- 🪦 **SPIFFE/SPIRE workload identity** — X.509 SVIDs auto-renewed from SPIRE agent; cryptographic attestation, no stored secrets
- ♻️ **Automated credential rotation** — `CredentialRotationScheduler` with configurable policies, grace-period dual-ref resolution, and full audit trail
- 🛠️ **CLI** — `audit verify`, `report`, `health`, `resolve` — for offline chain verification and compliance report generation

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

### The MCP ecosystem is growing fast

Model Context Protocol is becoming the standard integration layer for AI tools and agents. `agent-identity` participates in both directions: as an MCP server, it exposes credential resolution as callable tools to any MCP-capable client; as an MCP client, it can pull credentials from any MCP-compatible credential store. This means agent-identity integrates naturally into Claude Desktop, Claude Code, Cursor, Windsurf, and any custom MCP orchestration layer — without requiring a REST API call.

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
  userId: 'svc-migration-bot',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  traceId: 'trace-abc123',
  requestedAt: new Date().toISOString(),

  migrationId: 'migration-2026-q2-crm',
  phase: 'load',
  sourceResourceId: 'crm-postgres-prod',
  targetResourceId: 'crm-postgres-v2',
  dryRun: false,
  batchIndex: 3,
  totalBatches: 12,

  resourceId: 'crm-postgres-prod',
  resourceKind: 'shared',
  action: 'write',
};
```

**2. Phase-aware routing rules**

```typescript
{ id: 'migration-dryrun',   matchPhase: 'dry-run',            readOnly: true,  credentialRef: 'source-readonly-slot', priority: 60 },
{ id: 'migration-extract',  matchPhase: 'extract',            readOnly: true,  credentialRef: 'source-readonly-slot', priority: 60 },
{ id: 'migration-load',     matchPhase: ['load', 'rollback'],                  credentialRef: 'target-write-slot',    priority: 60 },
{ id: 'migration-verify',   matchPhase: 'verify',             readOnly: true,  credentialRef: 'source-readonly-slot', priority: 55 },
```

**3. `resolvePair()` — dual-credential resolution in one call**

```typescript
const pair = router.resolvePair(ctx);
// pair.source   → read-scoped credential for sourceResourceId
// pair.target   → write-scoped credential for targetResourceId (or read if dryRun)
// pair.expiresAt → ISO 8601 earliest expiry of both
// pair.migrationId → tied to ctx.migrationId for the full audit trail
```

**4. `POST /api/migrate/resolve` — batch-friendly HTTP endpoint**

Resolves both credentials in one round-trip. The agent calls this once per phase, not once per row.

**5. `validateForMigration()` — catch scope mismatches before data moves**

Every provider adapter implements `validateForMigration(credential, phase)`. Throws immediately if a read-only credential is used in a `load` or `rollback` phase — caught at the routing layer before any writes are attempted.

**6. `reserve()` / `release()` — prevent concurrent migration corruption**

```typescript
const reserved = await store.reserve('target-write-slot', ctx.migrationId, 7200);
if (!reserved) throw new Error('Credential in use by another migration. Abort.');
try {
  // ... batch loop
} finally {
  await store.release('target-write-slot', ctx.migrationId);
}
```

**7. `MigrationAuditLogEntry` — groupable, summarisable audit trail**

Extends `AuditLogEntry` with `migrationId`, `phase`, `rowsRead`, `rowsWritten`, `rowsFailed`, `dryRun`, `sourceCredentialId`, `targetCredentialId`, and `errorSummary`. `MigrationAuditLogger` adds `summarize(migrationId)` for post-run roll-ups.

**8. Migration tab in the UI**

Visual flow diagram, clickable phase timeline, configuration Q&A for common misconfigurations, and a copyable API quick-reference card.

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
- **Concurrent migration corruption is prevented by design** — `reserve()` locks a write credential to one migration ID for the duration of the batch; a second job receives `false` and must abort
- **MCP tool responses never include raw secrets** — `list_credentials` returns safe metadata only; `resolve_credential` returns `resolvedFor` and `credentialId`, not refs
- **Zero-trust attestation** — every `resolve()` call can sign a short-lived HMAC JWT attestation that downstream services verify independently
- **RFC 8693 token exchange** — no long-lived user tokens stored server-side; subject tokens are exchanged at request time and cached briefly; `invalidateCache()` / `flushCache()` for immediate revocation
- **JIT provisioning** — credentials are minted on demand and auto-revoked at TTL; a full store compromise yields zero usable long-lived secrets
- **SPIFFE/SPIRE** — workload identity cryptographically attested by SPIRE; SVIDs are short-lived X.509 certificates, no static secrets
- **auth.md / ID-JAG** — agents register via cryptographically signed assertions from trusted providers; `unclaimed` credentials cannot be resolved until the OTP claim ceremony completes; inbound `logout+jwt` revokes matching credentials immediately with jti replay protection

---

## Core concepts

### Identity types

- **User-delegated** — agent uses each user's own OAuth token or API key; enforces per-user entitlements
- **Fixed service** — agent uses a single shared service account; right for shared, equal-access resources
- **Hybrid** — agent selects the right credential per task within one workflow
- **Agent-as-service** — agent has its own machine identity; essential for multi-agent pipelines where agents call agents

### Credential routing

The routing engine (`packages/core/src/router.ts`) inspects each outbound call and selects the correct credential based on target resource type, calling user identity, migration phase, and configured `RoutingRule[]`. The model layer **never** sees raw credentials.

### Provider adapters

Adapters in `packages/core/src/providers.ts` normalise credential injection across providers. Implement `ProviderAdapter` to add any provider — routing rules and audit config are untouched. All adapters implement `validateForMigration()` to catch scope mismatches before data moves.

### MCP integration

`@datacules/agent-identity-mcp` registers five tools on a standard MCP server (stdio or HTTP+SSE) so any MCP-capable client can resolve credentials without touching the HTTP REST API. `@datacules/agent-identity-mcp-client` implements `CredentialStore` against any external MCP server, letting the router pull credentials from a Vault MCP server, 1Password MCP, or any custom credential MCP server as a drop-in backend.

---

## Adding a routing rule

```typescript
import type { RoutingRule } from '@datacules/agent-identity';

// Standard rule
const rule: RoutingRule = {
  id: 'rule-personal-docs',
  resourceKind: 'personal',
  credentialKind: 'user-delegated',
  credentialRef: 'user-oauth-ref',
  description: "Use the calling user's own token for personal document access.",
  priority: 10,
};

// Canary routing — 5% of traffic on new credential, ramp with no deployment
const canaryRule: RoutingRule = {
  id: 'rule-shared-crm',
  credentialRef: 'openai-prod-v1',
  canaryRef: 'openai-prod-v2',
  canaryWeight: 5,
  credentialKind: 'fixed',
  priority: 50,
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

// SPIFFE workload identity rule
const spiffeRule: RoutingRule = {
  id: 'rule-orders-agent',
  matchSpiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent',
  credentialRef: 'orders-db-slot',
  credentialKind: 'fixed',
  priority: 90,
};
```

---

## Project structure

```
agent-identity/
├── packages/
│   ├── core/                              # @datacules/agent-identity
│   │   └── src/
│   │       ├── types.ts
│   │       ├── router.ts                  # CredentialRouter, canary, budget, approval, attestation
│   │       ├── providers.ts
│   │       ├── decision.ts
│   │       ├── schemas.ts
│   │       ├── rotation.ts                # CredentialRotationScheduler
│   │       ├── attestation.ts             # HmacAttestationSigner, buildAttestation, verifyAttestation
│   │       ├── approval.ts                # ApprovalManager, MemoryApprovalStore, notifiers
│   │       ├── budget.ts                  # BudgetEnforcer, MemoryBudgetStore
│   │       ├── federation.ts              # FederationVerifier, FederationIssuer, IdentityChain
│   │       └── react/
│   │           └── useAgentIdentity.ts
│   ├── audit/                             # @datacules/agent-identity-audit
│   ├── stores/
│   │   ├── aws/                           # @datacules/agent-identity-store-aws
│   │   ├── vault/                         # @datacules/agent-identity-store-vault
│   │   ├── azure/                         # @datacules/agent-identity-store-azure
│   │   ├── spiffe/                        # @datacules/agent-identity-store-spiffe
│   │   ├── dynamic/                       # @datacules/agent-identity-store-dynamic (JIT provisioning)
│   │   ├── authmd/                        # @datacules/agent-identity-store-authmd (auth.md / ID-JAG)
│   │   └── libsql/                        # @datacules/agent-identity-store-libsql (SQLite / Turso)
│   ├── integrations/
│   │   ├── express/                       # @datacules/agent-identity-express
│   │   ├── fastify/                       # @datacules/agent-identity-fastify
│   │   ├── langchain/                     # @datacules/agent-identity-langchain
│   │   ├── nestjs/                        # @datacules/agent-identity-nestjs
│   │   ├── mcp/                           # @datacules/agent-identity-mcp (inbound)
│   │   ├── mcp-client/                    # @datacules/agent-identity-mcp-client (outbound)
│   │   ├── otel/                          # @datacules/agent-identity-otel
│   │   ├── anomaly/                       # @datacules/agent-identity-anomaly
│   │   ├── compliance/                    # @datacules/agent-identity-compliance
│   │   └── token-exchange/                # @datacules/agent-identity-token-exchange (RFC 8693)
│   ├── cli/                               # @datacules/agent-identity-cli
│   └── python-sdk/                        # pip install datacules-agent-identity
├── src/                               # Next.js 14 dashboard app (17 tabs)
├── assets/logo.svg                    # master brand mark
├── public/logo.svg                    # static copy served by Next.js at /logo.svg
├── docs/openapi.yaml
├── Dockerfile + docker-compose.yml
└── .github/workflows/
    ├── ci.yml                         # type-check, lint, test (Node + Python), build + smoke
    └── publish.yml                    # npm + PyPI publish on vX.Y.Z tag
```

---

## Releasing

The publish workflow fires automatically on a version tag push:

```bash
git tag v0.9.0
git push origin v0.9.0
```

This stamps all 21 workspace `package.json` versions from the tag (20 npm packages + 1 Python SDK), builds core ESM + CJS, publishes all `@datacules/*` packages to npm with provenance, and publishes the Python wheel to PyPI. A GitHub Release with auto-generated notes is created once both publish jobs succeed.

See `.github/workflows/publish.yml` and `CONTRIBUTING.md` for setup instructions.

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

`#AIAgents` `#OpenSource` `#AgentIdentity` `#LLMSecurity` `#MultiAgentSystems` `#AIEngineering` `#FutureOfAI` `#DevSecOps` `#Accountability` `#TrustInAI` `#DataMigration` `#MCP` `#ModelContextProtocol` `#OpenTelemetry` `#ZeroTrust`

---

## License

Copyright © 2026 Datacules LLC. Released under the [Datacules Open Source License](LICENSE) — permissive, commercial-friendly, no copyleft requirement.
