# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.2.0] — 2026-05-28

Major release. Transforms `agent-identity` from a single-repo Next.js application into a
full-featured, publishable **Turborepo monorepo** with 17 packages across npm and PyPI.

### New packages

| Package | npm name | Description |
|---|---|---|
| `packages/core` | `@datacules/agent-identity` | Core router, types, Zod schemas, React hook |
| `packages/audit` | `@datacules/agent-identity-audit` | Console, Webhook, Datadog, Splunk, Composite sinks |
| `packages/stores/aws` | `@datacules/agent-identity-store-aws` | AWS Secrets Manager + DynamoDB migration locks |
| `packages/stores/vault` | `@datacules/agent-identity-store-vault` | HashiCorp Vault KV v2 |
| `packages/stores/azure` | `@datacules/agent-identity-store-azure` | Azure Key Vault + Table Storage |
| `packages/stores/spiffe` | `@datacules/agent-identity-store-spiffe` | SPIFFE/SPIRE workload identity via X.509 SVIDs |
| `packages/stores/dynamic` | `@datacules/agent-identity-store-dynamic` | JIT credential provisioning (Vault dynamic secrets, AWS IAM Roles Anywhere, Azure Managed Identity) |
| `packages/integrations/express` | `@datacules/agent-identity-express` | Express middleware |
| `packages/integrations/fastify` | `@datacules/agent-identity-fastify` | Fastify plugin |
| `packages/integrations/langchain` | `@datacules/agent-identity-langchain` | LangChain `StructuredTool`, LCEL wrapper, LangGraph node |
| `packages/integrations/nestjs` | `@datacules/agent-identity-nestjs` | NestJS `DynamicModule`, `@Injectable()` service, `CanActivate` guard, `@ResolvedCredential()` decorator |
| `packages/integrations/mcp` | `@datacules/agent-identity-mcp` | MCP server (stdio + HTTP+SSE) — 5 tools: resolve, resolve_migration, list_credentials, list_rules, health |
| `packages/integrations/mcp-client` | `@datacules/agent-identity-mcp-client` | MCP client — `McpCredentialStore` + `McpToolCaller` |
| `packages/integrations/otel` | `@datacules/agent-identity-otel` | OpenTelemetry tracing — `withOtel()` wrapper emitting spans on every `resolve()` call |
| `packages/integrations/anomaly` | `@datacules/agent-identity-anomaly` | Behavioral baseline anomaly detection with EWMA scoring, configurable response policies |
| `packages/integrations/compliance` | `@datacules/agent-identity-compliance` | Compliance report generator — SOC 2, GDPR, HIPAA report templates from audit log store |
| `packages/python-sdk` | `agent-identity` (PyPI) | Python 3.8+ client — sync + async, Pydantic v2, zero runtime deps, CLI |

### Core package additions (`@datacules/agent-identity`)

**Router extensions:**
- `resolveAsync(ctx)` — async resolution path for cloud store backends
- `resolvePairAsync(ctx)` — async dual-credential resolution for migration workflows
- `RouterConfig` — unified config object replacing positional args
- Canary routing — `canaryRef` and `canaryWeight` (0–100) on `RoutingRule`; weighted random selection tags each resolution with `isCanary: boolean`
- Attestation hook — `AttestationSigner` interface; `credentialAttestation?: string` on `ResolvedCredential`
- Budget gate — checks `BudgetPolicy` before resolution; returns `{ status: 429, retryAfter }` at hard limit
- Approval gate — checks `ApprovalPolicy` before resolution; holds pending requests until approved, rejected, or timed out

**New core modules:**
- `packages/core/src/rotation.ts` — `RotationPolicy`, `RotationProvider`, `CredentialRotationScheduler`
  - `rotateAfterDays`, `rotateAfterUses`, `gracePeriodSeconds`, `notifyBeforeDays`
  - Fires `credential.rotated`, `credential.rotation_due`, `credential.rotation_failed` audit events
- `packages/core/src/attestation.ts` — `HmacAttestationSigner`, `buildAttestation()`, `verifyAttestation()`
  - Short-lived HMAC-signed JWT attestations tied to each resolution
- `packages/core/src/approval.ts` — `ApprovalManager`, `MemoryApprovalStore`, `WebhookApprovalNotifier`, `SlackApprovalNotifier`
  - Break-glass override with mandatory justification and non-deletable audit entry
- `packages/core/src/budget.ts` — `BudgetEnforcer`, `MemoryBudgetStore`, `BudgetResult`
  - Per-credential hourly/concurrent/daily limits; soft threshold warning events; reset schedule
- `packages/core/src/federation.ts` — `FederationVerifier`, `FederationIssuer`, `IdentityChain`
  - Signed cross-org identity chains carrying full principal history across trust boundaries

**Type system additions:**
- `RotationPolicy`, `BudgetPolicy`, `ApprovalPolicy` on `Credential` / `RoutingRule`
- `canaryRef`, `canaryWeight` on `RoutingRule`
- `credentialAttestation`, `isCanary` on `ResolvedCredential`
- `IdentityChainEntry`, `FederationConfig`, `AttestationSigner` interfaces

**Published contract:**
- `packages/core/src/schemas.ts` — Zod schemas for every public type; exported from `@datacules/agent-identity/schemas`
- `packages/core/src/react/useAgentIdentity.ts` — production-safe hook; auto-refresh 60 s before expiry
- `packages/core/src/react/useMigrationIdentity.ts` — migration hook variant

### Dashboard additions (Next.js app)

Seven new interactive tabs added to the dashboard (total: 10):

| Tab | Description |
|---|---|
| `AttestationTab` | Sign and verify JWT attestation tokens; decoded payload inspector; live expiry countdown |
| `CanaryTab` | Configure canary weight splits on routing rules; simulate N requests; visualise distribution |
| `ApprovalTab` | Approval request queue; per-request Approve/Reject/Break-glass; stats strip; filter by status |
| `BudgetTab` | Per-credential usage bars with soft threshold markers; interactive resolution simulator; reset button |
| `FederationTab` | Cross-org identity chain builder; trust domain registry; verify and extend chain |
| `MigrationTab` | (previously added) Phase timeline; configuration Q&A; API quick-reference |

### New API routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/attest` | Verify a JWT attestation token |
| `POST` | `/api/attest/sign` | Sign a new attestation for an `AgentRequestContext` |
| `POST` | `/api/approve` | Approve or reject a pending approval request |
| `POST` | `/api/approve/break-glass` | Emergency break-glass override — requires justification |
| `GET` | `/api/budget` | Current utilisation for all budget-enabled credentials |
| `POST` | `/api/budget/reset` | Reset hourly or daily counter for a credential |
| `POST` | `/api/federation/issue` | Issue a new signed identity chain |
| `POST` | `/api/federation/verify` | Verify an inbound identity chain against trust config |

### CI / DevOps

- Python SDK test suite added to CI (`Unit tests (Python SDK)` job — 16 test cases via `unittest.mock`)
- `Unit tests (Python SDK)` added to `needs` chain of `Build + smoke test` gate
- Smoke test server wait bumped from 60 s to 90 s (cold runner headroom)
- `.github/workflows/publish.yml` — automated publish on `vX.Y.Z` tags:
  - `publish-npm` — stamps all workspace `package.json` versions, builds core, publishes `@datacules/*` with npm provenance
  - `publish-python` — stamps `pyproject.toml` version, builds sdist + wheel, publishes to PyPI via OIDC trusted publishing
  - `github-release` — creates GitHub Release with auto-generated notes after both publish jobs succeed

### Bug fixes

- `router.ts`: replaced `instanceof MemoryCredentialStore` check (breaks under vitest module isolation) with duck-type `isSyncCapable(store)` checking for `findByRefSync` as a method
- `credentials.ts`: promoted `cred-gmail` from `status: 'pending'` to `'active'` — was silently returning `null` on all resolutions
- `vitest.config.ts`: wired missing `@vitejs/plugin-react` plugin — future `.tsx` test imports would have failed without it
- `sidecar/server.ts`: fixed import path for `AgentRequestContextSchema` from barrel to `@datacules/agent-identity/schemas` subpath
- `FederationConfig` / `IdentityChainEntry` imports in Phase 3 API routes: corrected to `@/lib/federation` shim rather than `@/lib/types`
- `ApprovalTab`: renamed lowercase `statusBadge` helper to `StatusBadge` component; renamed inner `resolve` function to `resolveRequest` to avoid shadowing
- `FederationTab`: replaced mixed-type tuple array + `as` casts with typed `ExtendField[]` interface — eliminates implicit `any` in map
- Removed unused `ApprovalManager` import + `manager` variable from `approve/route.ts` (ESLint `no-unused-vars`)
- Removed unused `BudgetEnforcer` import + `enforcer` variable from `budget/route.ts` (ESLint `no-unused-vars`)
- Added missing workspace entries for `stores/dynamic`, `integrations/anomaly`, `integrations/compliance` to root `package.json`

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter` with `resourceKind`-based routing
- Multi-field routing: `RoutingRule` now supports `matchAction`, `matchProvider`, `matchUserId`, `priority` scoring
- `CredentialStore` and `AuditLogger` interfaces — dependency injection on `CredentialRouter`
- `MemoryCredentialStore` — default in-memory implementation for local dev
- `expiresAt`, `lastRotated`, `refreshTokenRef`, `rotationIntervalDays` fields on `Credential`
- Expiry check in `router.resolve()` — expired credentials return null
- `traceId`, `sessionId`, `requestedAt`, `parentTraceId` fields on `AgentRequestContext`
- `AuditLogEntry` typed interface
- Provider adapters for OpenAI, Anthropic, Gemini, Mistral, local
- Server-side credential resolution API route (`/api/resolve`, `/api/migrate/resolve`) — credentials never exposed to client bundle
- `MigrationContext`, `resolvePair()`, phase-aware routing, `reserve()` / `release()` TTL locks
- Decision helper: `computeDecision()` with all five auth patterns
- CI pipeline: type-check, lint, build, smoke test, Vitest unit tests
- Datacules open-source license and branding
