# Enhancements — agent-identity

> Proposed, in-progress, and future improvements to the `agent-identity` framework.
> Organised by target release version. Status icons indicate development stage.

## Status Key

| Icon | Meaning |
|------|---------|
| 🟢 | In progress — code exists on a branch or `main [Unreleased]` |
| 🟡 | Planned — scoped and prioritised for the target release |
| 🔵 | Proposed — under evaluation, not yet formally scoped |
| ⚪ | Long-term / future vision — no active planning yet |

---

## v0.10.0 — Auth.md + LibSQL Official Release

> **Target**: June – July 2026
> All items in this block are already merged to `main` but sit in the `[Unreleased]` CHANGELOG section awaiting an official version tag.

### 🟢 `@datacules/agent-identity-store-libsql` — Production LibSQL / Turso store (PR #46)

A zero-native-binding credential persistence layer implementing all four `agent-identity` store interfaces via `@libsql/client`. One connection string switch moves you from a local embedded SQLite file to a globally distributed Turso replica set with no code changes.

**Classes shipped:**
- `LibSqlCredentialStore` — `CredentialStore` (`findByRef`, `listActive`, `listByKind`, `reserve`, `release`, `revokeByIdentity`, `upsert`)
- `LibSqlApprovalStore` — `ApprovalStore` (`create`, `get`, `update`, `listPending`)
- `LibSqlBudgetStore` — `BudgetStore` (hourly sliding-window counters, daily spend, concurrent session tracking)
- `LibSqlAuditLogger` — `MigrationAuditLogger` (`log`, `summarize`)
- `createLibSqlStores()` — one-call factory; opens connection, bootstraps schema, returns all four stores
- `bootstrapSchema()` / `SCHEMA_DDL` — 6 tables, 8 indexes, all `IF NOT EXISTS`

**Schema tables**: `ai_credentials`, `ai_reservations`, `ai_approval_requests`, `ai_budget_hourly`, `ai_budget_daily`, `ai_audit_log`

**Test coverage**: 32 Vitest cases using mock client injection (no real SQLite or Turso connection required in CI)

**Readme tag**: `v0.10.0`

---

### 🟢 auth.md Enhancements — G-A1 through G-A6 (PR #45)

Full WorkOS auth.md / ID-JAG protocol support added to the auth.md store and core packages.

| Enhancement | Detail |
|-------------|--------|
| **G-A1** `AgentAuthMdStore` | Full auth.md registration client; ID-JAG, verified-email, and anonymous OTP flows; RFC 9728 PRM discovery |
| **G-A2** `unclaimed` CredentialStatus | New status tier for anonymous auth.md credentials that have not yet completed the OTP claim ceremony; router returns `null` for unclaimed credentials |
| **G-A3** Inbound Revocation | `RevocationHandler` — `logout+jwt` processor with jti replay protection and configurable TTL eviction; `RevocationListener` — framework-agnostic HTTP handler for `revocation_uri` endpoints |
| **G-A4** Type / Schema extensions | `TrustedIdentityProvider`, `TrustedProviderRegistry` types and Zod schemas; `Credential` extended with `preClaimScopes`, `postClaimScopes`, `claimedAt`, `claimToken` |
| **G-A5** `AsymmetricAttestationSigner` | RS256/ES256 JWT signer/verifier via Web Crypto API for ID-JAG compatibility; `fromKeyPair()` for signing, `fromPublicJwk()` for verify-only |
| **G-A6** `validateIdJagClaims()` | Claim-layer validation covering issuer trust, provider enable, expiry, audience, verified identity, and AMR checks |

**Test coverage added**: attestation (8), revocation (4), revocation-listener (6), identity-providers (12), AgentAuthMdStore (22) = 52 new cases

**Readme tag**: `v0.10.0`

---

### 🟢 `CredentialRotationScheduler` Enhancements — rotateAfterUses + Grace Period (PR #47)

Extends the rotation scheduler beyond time-based rotation with usage-count rotation and zero-downtime handover.

- **`rotateAfterUses`** — accepts an optional `getUsageCount(credentialId)` callback; `isRotationDue()` is now `async` and checks use count when the callback is supplied, enabling rotation after a configured number of invocations regardless of time elapsed
- **Grace period** — a `graceWindows` Map tracks the old ref for `gracePeriodSeconds` after rotation; `runOnce()` skips re-rotation during the window; `inGracePeriod()` and `getGraceRef()` are exposed for routers that need dual-ref acceptance during handover
- **`RotationSchedulerOptions`** interface + static `fromOptions()` factory
- Constructor is backwards-compatible (`getUsageCount` is an optional third parameter)

**Readme tag**: `v0.10.0`

---

### 🟢 `AzureManagedIdentityProvisioner` for JIT store (PR #47)

The `@datacules/agent-identity-store-dynamic` package gains a full Azure Managed Identity provisioner (was previously unimplemented in the dynamic store).

- Supports **system-assigned** managed identities via the Azure IMDS endpoint (`http://169.254.169.254/metadata/identity/oauth2/token`)
- Supports **user-assigned** managed identities via `clientId` or `resourceId` query parameter
- Follows the same `DynamicProvisioner` interface as `VaultDynamicProvisioner` and `AwsRolesAnywhereProvisioner`
- TTL derived from the `expires_in` field of the IMDS token response

**Readme tag**: `v0.10.0`

---

### 🟢 Decision Helper Reliability — `DECISION_QUESTIONS` export + 5 bug fixes (PR #49)

The core `packages/core/src/decision.ts` and app-layer `src/lib/decision.ts` / `DecisionTab.tsx` were synchronised and five bugs fixed:

1. Context-switched path was gated on Q4 (now resolves from Q1+Q2 only)
2. Q3 (auditRequired) was shown and required on variable-access paths where it has no effect
3. `!variableAccess && mixedResources && auditRequired=true` produced the same label as `auditRequired=false`
4. Q4 `showIf` was too broad (included context-switched path)
5. `pick()` state cascade was incomplete (stale answers persisted across path changes)

`DECISION_QUESTIONS` is now exported from `src/lib/decision` and imported by `DecisionTab.tsx`, making the question registry independently testable.

**Test expansion**: 8 → 14 cases + new `DECISION_QUESTIONS` suite

**Readme tag**: `v0.10.0`

---

## v0.11.0 — Phase 3: JIT Approval Workflows

> **Target**: Q3 2026
> Branch `feat/phase3-jit-approvals` has been created but has no commits yet.

### 🟡 `DynamicCredentialStore` Server-side API Integration

The existing `DynamicCredentialStore` package is fully implemented and tested, but the Next.js server layer (`src/lib/server/credentialStore.ts`) does not yet wire it in as a selectable backend via `CREDENTIAL_STORE_TYPE=dynamic`. The `getServerStore()` factory should be extended with a `dynamic` case that bootstraps the appropriate provisioner from environment variables.

**Proposed env vars**: `DYNAMIC_PROVISIONER` (`vault|aws|azure`), `VAULT_DYNAMIC_MOUNT`, `VAULT_DYNAMIC_ROLE`, `AWS_ROLES_ANYWHERE_PROFILE_ARN`, `AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN`, `AZURE_MI_CLIENT_ID`

---

### 🟡 `ApprovalTab` Server-side API Routes

The `ApprovalTab.tsx` dashboard component is fully implemented with interactive UI, but the backing API routes (`POST /api/approve`, `POST /api/approve/break-glass`) currently use an in-memory `MemoryApprovalStore`. Phase 3 should:

- Connect approval routes to `LibSqlApprovalStore` (or any configured `ApprovalStore`) via the same `getServerStore()` factory pattern used for credential stores
- Implement real webhook/email/Slack notifiers via `ApprovalManager`
- Add `GET /api/approve/{requestId}` — poll approval status from the persistent store
- Support configurable approval TTL and automatic rejection on timeout

---

### 🟡 `BudgetTab` Server-side API Routes

Similar to the approval gap: `BudgetTab.tsx` is UI-complete but `GET /api/budget` and `POST /api/budget/reset` currently operate against in-memory state that does not persist across server restarts or scale out to multiple replicas.

- Connect budget routes to `LibSqlBudgetStore` (via `getServerStore()` factory)
- `GET /api/budget` should return per-credential hourly + daily usage from the persistent store
- Add `GET /api/budget/{credentialId}/history` — time-series usage for charting
- Enforce budget limits in the server-side `resolveAsync()` path (currently only enforced in the router layer if `BudgetEnforcer` is wired)

---

### 🟡 `GET /api/health` Endpoint

*(Also tracked as ISS-001 in `issues.md`)*

The CLI `health` command calls `GET /api/health` but no such Next.js route exists. This endpoint should be created as part of Phase 3 server hardening:

```typescript
// src/app/api/health/route.ts
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version,
    timestamp: new Date().toISOString(),
    credentialsLoaded: (await store.listActive()).length,
    rulesLoaded: rules.length,
  });
}
```

---

### 🟡 LibSQL Store for Server-side Approval and Budget

Extend `getServerStore()` / `getServerApprovalStore()` / `getServerBudgetStore()` factory functions to return `LibSqlApprovalStore` and `LibSqlBudgetStore` when `LIBSQL_URL` is configured, enabling persistent approval queues and budget counters in the Next.js app without external infrastructure.

---

## v0.12.0 — Ecosystem Expansion

> **Target**: Q4 2026

### 🟡 CrewAI Integration — `@datacules/agent-identity-crewai`

A Python-level integration analogous to the LangChain package, enabling CrewAI agents to resolve credentials via the sidecar HTTP API with minimal boilerplate. Should expose a `AgentIdentityTool` that CrewAI tasks can reference, and a `resolve_credential()` helper for the Python SDK.

### 🟡 AutoGen / smolagents Integration

Integration adapters for the Microsoft AutoGen multi-agent framework and Hugging Face smolagents, following the same pattern as the LangChain `createAgentIdentityNode()` for LangGraph.

### 🟡 PostgreSQL Credential Store — `@datacules/agent-identity-store-pg`

A `CredentialStore` implementation backed by PostgreSQL (via `pg` or `drizzle-orm`), providing a relational alternative to LibSQL/Turso for organisations already running Postgres. Should implement the same interface as `LibSqlCredentialStore` including `reserve()`/`release()` using `SELECT … FOR UPDATE SKIP LOCKED`.

### 🟡 Redis Session / Budget Store — `@datacules/agent-identity-store-redis`

A `BudgetStore` and optional `AuditLogger` backed by Redis, using sliding-window counters via `ZADD`/`ZRANGEBYSCORE`. Ideal for high-throughput deployments where the per-hour resolution rate makes SQLite or Postgres a bottleneck.

### 🔵 OpenAPI Spec — Keep in sync with route changes

`docs/openapi.yaml` is currently at v0.6.0 and does not document:
- `POST /api/approve/break-glass` (exists but not in spec)
- `DELETE /api/anomaly?userId=` (exists but not in spec)
- `GET /api/budget` (exists but not in spec)
- `POST /api/budget/reset` (exists but not in spec)
- `GET /api/health` (missing — also ISS-001)

Consider adopting `zod-to-openapi` or `@anatine/zod-openapi` to generate the spec automatically from the existing Zod schemas, eliminating manual drift.

### 🔵 WebAuthn / Passkey Agent Registration

Extend the auth.md registration flow to accept WebAuthn assertions as an alternative to OTP claim ceremonies for anonymous agents. Would allow agent frameworks running in browser-based environments to register without an email round-trip.

### 🔵 Kubernetes Operator — `agent-identity-operator`

A Kubernetes controller that watches `AgentCredential` CRDs and maintains the credential lifecycle (creation, rotation, revocation) directly in-cluster, eliminating the need for agents to call the HTTP sidecar. Uses SPIFFE/SPIRE for workload attestation by default.

---

## v1.0.0 — Stable API + Commercial Readiness

> **Target**: H1 2027

### 🔵 Semantic Versioning Stabilisation

All `@datacules/*` packages remain in `0.x` minor versioning. v1.0.0 signals:
- No breaking changes to `CredentialStore`, `AuditLogger`, `ProviderAdapter`, or `RoutingRule` interfaces without a major version bump
- Full semver compatibility guarantees across the monorepo
- Long-term support (LTS) designation for `packages/core`

### 🔵 Enterprise Compliance Pack

A bundled set of compliance report templates, audit chain verification scripts, and policy-as-code examples (OPA/Rego) for organisations that need to demonstrate SOC 2 Type II, HIPAA, ISO 27001, or EU AI Act compliance for their agentic workloads.

### 🔵 Hosted Dashboard (SaaS tier)

A managed version of the interactive dashboard at `dashboard.datacules.com`, connected to a shared Turso cluster, enabling teams to visualise credential routing, audit logs, and anomaly events across multiple agent deployments without self-hosting.

### 🔵 Commercial Support SLA

Paid support tier for enterprise adopters, covering SLA-backed responses, private patch builds, and dedicated Slack/Teams channels.

---

## Long-Term / Future Vision

> No active planning. Listed for community discussion.

### ⚪ Edge Runtime Support

Support for Cloudflare Workers, Vercel Edge, and Deno Deploy runtimes. The current `node:crypto` usage in `attestation.ts` is already using Web Crypto API (`crypto.subtle`), which is a prerequisite. The main blockers are the cloud store packages that use Node.js-specific SDKs (`@aws-sdk`, `@azure/*`).

### ⚪ Multi-region Credential Store Federation

A federated `CredentialStore` that replicates credential metadata across multiple regions (e.g., Turso replicas or DynamoDB Global Tables) with read-local / write-primary routing, enabling sub-10ms credential resolution for global agentic deployments.

### ⚪ GraphQL API

A GraphQL schema over the credential resolution and audit log APIs, enabling richer query patterns (e.g., "list all credentials resolved by user X in the last 7 days with anomaly events") without multiple REST round-trips.

### ⚪ Decentralised Identity (DID) Integration

Support for W3C DID (Decentralised Identifiers) as a principal type in `AgentRequestContext`, enabling agent identity anchored to blockchain or IPFS-based identity registries without a centralised auth provider.

### ⚪ Zero-Knowledge Proof Attestation

An `AttestationSigner` implementation based on ZK-SNARKs, allowing an agent to prove that it holds a valid credential without revealing which credential it is — useful for privacy-preserving multi-agent pipelines where intermediate hops should not learn the identity of the calling principal.

---

*Last updated: 2026-06-06. To propose an enhancement, open a GitHub issue with the label `enhancement` and reference this document.*
