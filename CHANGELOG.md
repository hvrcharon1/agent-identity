# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**Fastify plugin test coverage (`packages/integrations/fastify/src/fastify.test.ts`) — 12 cases**
- Previously the only framework integration package (alongside NestJS) with zero Vitest test coverage.
- No fastify runtime dependency required — Fastify uses `import type` for
  `FastifyPluginAsync`, `FastifyRequest`, `FastifyReply`; type imports are erased
  at runtime. A minimal mock Fastify instance captures `decorateRequest` and
  `addHook` calls; the preHandler hook is extracted directly and invoked in tests.
- `plugin registration` (1 case): `agentIdentityPlugin` is a valid fastify-plugin —
  `Symbol.for('skip-override')` is set to `true` by `fp()`, confirming the
  encapsulation bypass is in place.
- `passThrough behavior` (4 cases): absent agentContext + passThrough=true sends no
  reply; undefined req.body + passThrough=true sends no reply; passThrough=false
  sends 400; 400 error message names the missing contextKey field.
- `credential resolution` (5 cases): resolvedCredential attached to request on
  successful resolution; resolvedFor='service' for fixed creds; resolvedFor=ctx.userId
  for user-delegated creds; 403 when no rule matches; 403 when matched credential
  is expired.
- `custom contextKey` (2 cases): reads agent context from correct body field;
  400 error message names the custom contextKey when passThrough=false.

**NestJS integration test coverage (`packages/integrations/nestjs/src/nestjs.test.ts`) — 12 cases**
- Previously the only NestJS integration package with zero Vitest test coverage.
- NestJS decorators (`@Injectable`, `@Inject`, `CanActivate`, `ExecutionContext`,
  `ForbiddenException`, `createParamDecorator`) are mocked via `vi.mock()` factory
  hoisted before module import — no `@nestjs/common` runtime dependency required.
  `AgentIdentityService` and `AgentIdentityGuard` are instantiated directly,
  bypassing the NestJS DI container entirely.
- `AgentIdentityService.resolve()` (4 cases): returns ResolvedCredential with correct
  credentialId; resolvedFor='service' for fixed creds; resolvedFor=ctx.userId for
  user-delegated creds; returns null when no rule matches.
- `AgentIdentityService.resolveAsync()` (2 cases): returns the same result as
  resolve() via the async path; returns null on no match.
- `AgentIdentityService.resolvePairAsync()` (2 cases): returns ResolvedCredentialPair
  with source, target, and migrationId when both rules match; returns null when no
  rule matches the migration context.
- `AgentIdentityGuard.canActivate()` (3 cases): returns true and does not attach
  credential when no agentContext is present (non-agent route pass-through); returns
  true and attaches resolvedCredential to request under `RESOLVED_CREDENTIAL_KEY`
  on success; throws ForbiddenException when resolveAsync() returns null.
- `AgentIdentityGuard.extractContext()` (2 cases): returns the agentContext object
  from request.body; returns null when request.body is absent.

### Fixed

**`@datacules/agent-identity-otel` — `resolvePairAsync()` correctness gap**
- `TracedRouter` interface was missing `resolvePairAsync()`, which was added
  to `CredentialRouter` in the v0.3.0 hardening pass (PR #19). Any consumer
  who called `resolvePairAsync()` on a `withOtel()`-wrapped router received a
  runtime "not a function" error. The method is now added to both the interface
  and the `withOtel()` return object, so all four resolution paths are covered.
- Extracted `annotateMigrationCtx()` private helper to avoid repeating the
  three migration attribute `setAttribute` calls in `resolvePair` and
  `resolvePairAsync`.

**OTEL test coverage (`packages/integrations/otel/src/otel.test.ts`) — 13 cases**
- Previously the only feature package with zero Vitest test coverage.
- Mock tracer and span are plain `vi.fn()` objects — no `@opentelemetry/api`
  runtime dependency is required (the source only uses `import type`).
- `withOtel — resolve()` (5 cases): span name, standard attributes,
  `routing.resolved=true` with credential attributes, `routing.resolved=false`
  on null, span ends even when router throws.
- `withOtel — resolveAsync()` (3 cases): span name, awaited result propagated,
  exception recorded + span ended on rejection.
- `withOtel — resolvePair()` (3 cases): span name + migration attrs, pair
  returned with `routing.resolved=true`, span ends on throw.
- `withOtel — resolvePairAsync()` (2 cases): span name, `routing.resolved=false`
  on null; rejection records exception and ends span.

**LangChain test coverage (`packages/integrations/langchain/src/langchain.test.ts`) — 12 cases**
- The test file described in PR #2 (`__tests__/langchain.test.ts`) was never
  committed to the final merged branch. This PR adds full coverage.
- `@langchain/core/callbacks/base` is mocked via `vi.mock()` factory — works
  whether or not `@langchain/core` is installed in root node_modules.
- `createAgentIdentityModel` (5 cases): resolved metadata returned, correct
  `credentialId` / `resolvedFor`, `getModel` is a function, throws on no rule
  match, `fetchSecret` called with resolved ref before unsupported-provider throw.
- `AgentIdentityCallbackHandler` (3 cases): instantiates, `handleLLMStart`
  attaches `agentIdentityCredentialId` and `agentIdentityResolvedFor` to
  `extraParams`, `handleLLMEnd` resolves without throwing.
- `createAgentIdentityNode` (4 cases): `resolvedCredential` injected into state,
  all existing state properties preserved, throws on missing `agentContext`,
  throws on no-match credential.

**Express middleware test coverage (`packages/integrations/express/src/express.test.ts`) — 13 cases**
- Previously the only framework integration package with zero Vitest test coverage.
- No express runtime dependency required — `express` is only used via `import type`
  in the source, so type imports are erased and req/res/next are plain `vi.fn()` mocks.
- `passThrough behavior` (4 cases): absent agentContext + passThrough=true calls next;
  undefined req.body + passThrough=true calls next; passThrough=false sends 400;
  400 error message names the missing contextKey field.
- `credential resolution` (7 cases): resolvedCredential attached to req on match;
  next() called and no response sent on match; resolvedFor='service' for fixed creds;
  resolvedFor=ctx.userId for user-delegated creds; 403 when no rule matches;
  403 when matched credential is expired; audit logger invoked synchronously on success.
- `custom contextKey` (2 cases): reads context from correct body field;
  400 error message names the custom contextKey when passThrough=false.

**MCP tools test coverage (`packages/integrations/mcp/src/mcp.test.ts`) — 14 cases**
- Previously the only MCP integration package with zero Vitest test coverage.
- `tools.ts` imports only `zod` and `@datacules/agent-identity` — no
  `@modelcontextprotocol/sdk` runtime dependency needed (the SDK is only imported
  in `index.ts` and `transports.ts`). Tool handlers are called directly with a
  `ToolDeps` object containing a `MemoryCredentialStore` and routing rules.
- `resolve_credential` (4 cases): credentialId/kind/resolvedFor returned on success;
  raw ref never appears in response; isError=true when no rule matches;
  isError=true with Zod validation error.
- `resolve_migration_credential` (3 cases): source/target/migrationId returned on
  success (both contexts resolved via shared openai rule); isError=true when unmatched
  provider; isError=true with Zod validation error when migrationId is absent.
- `list_credentials` (3 cases): all active credentials returned with safe metadata
  and no raw ref field; filtered to fixed only; filtered to user-delegated only.
- `list_rules` (2 cases): rules returned sorted by priority descending; both rule ids
  present in result.
- `health` (2 cases): status=ok with credentialsLoaded/rulesLoaded/timestamp;
  timestamp is a valid ISO 8601 string.

---

## [0.3.0] — 2026-05-29

### Added

**Dashboard — `AnomalyTab` (tab #11)**
- `src/components/AnomalyTab.tsx` — full interactive anomaly detection dashboard
  - Live agent baseline table showing sample count, known actions/resources/providers, and EWMA call rate
  - Anomaly event feed with severity badges (low/medium/high), signal labels, and relative timestamps
  - Decoded baseline vs. observed values side-by-side for each event
  - Policy configuration panel — per-severity action (warn/throttle/block), baseline samples, rate spike threshold
  - Run `observe()` simulator for any selected agent — generates real anomaly events and updates baseline state
  - Reset baseline button per agent; filters by severity (all/high/medium/low)
  - Live code snippet: copy-paste `AnomalyDetector` config for your app
- `src/app/api/anomaly/route.ts` — `POST /api/anomaly` (observe) + `DELETE /api/anomaly?userId=` (reset baseline)
- `src/lib/anomaly.ts` — re-export shim for `@datacules/agent-identity-anomaly`, mirrors the approval/budget/federation pattern
- `src/app/page.tsx` — `AnomalyTab` added as tab #11 with `IconAlertTriangle` (AlertTriangle SVG)

**OpenAPI spec v0.3.0**
- `docs/openapi.yaml` bumped from `0.1.0` to `0.3.0`
- All 9 endpoints added since v0.1.0 are now documented:
  `POST /api/attest`, `POST /api/attest/sign`, `POST /api/approve`, `POST /api/approve/break-glass`,
  `GET /api/budget`, `POST /api/budget/reset`, `POST /api/federation/issue`, `POST /api/federation/verify`,
  `POST /api/anomaly`
- Full request/response schemas for all new endpoints

**Test coverage — Phase 1–4 modules (PR #17)**
- 86 new Vitest test cases across 6 files:
  - `packages/core/src/attestation.test.ts` — 18 cases (`HmacAttestationSigner`, `buildAttestation`, `verifyAttestation`)
  - `packages/core/src/budget.test.ts` — 16 cases (`MemoryBudgetStore`, `BudgetEnforcer`, audit events)
  - `packages/core/src/approval.test.ts` — 14 cases (`MemoryApprovalStore`, `ApprovalManager`, break-glass, notifiers)
  - `packages/core/src/federation.test.ts` — 12 cases (`FederationVerifier`, `FederationIssuer`, chain issue/extend/verify)
  - `packages/core/src/rotation.test.ts` — 12 cases (`CredentialRotationScheduler`, audit events, start/stop)
  - `packages/integrations/compliance/src/hashchain.test.ts` — 14 cases (`HashChainAuditLogger`, `ChainVerifier`, tamper detection)

**Test coverage — anomaly package (PR #20)**
- 16 new Vitest test cases in `packages/integrations/anomaly/src/anomaly.test.ts`:
  - Baseline collection phase (3): no events during collection, resolveFunc still called, baseline learning
  - Scoring phase detection (5): new_provider, new_action_type, new_resource_kind, no events on known values, rate_spike
  - Policy actions (2): block returns null + skips resolveFunc, warn continues resolving
  - Audit logger integration (3): credential.anomaly entries, signal/severity fields, onAnomaly callback
  - Baseline management (2): resetBaseline() restores collecting state, independent baselines per agent
  - Edge cases (1): baseline not updated when resolveFunc returns null

**Test coverage — DynamicCredentialStore + provisioners (PR #21)**
- 13 new Vitest test cases in `packages/stores/dynamic/src/dynamic.test.ts`:
  - `DynamicCredentialStore` (6): provision, TTL caching, cache:false bypass, renew-before-expiry re-provision, listActive, listByKind
  - `VaultDynamicProvisioner` (4): correct endpoint + token header, lease response mapping, 403 error throw, revoke call
  - `AwsRolesAnywhereProvisioner` (3): correct sessions endpoint, credential set mapping, 401 error throw
  - All external HTTP calls mocked via `vi.stubGlobal('fetch', ...)` — no live Vault or AWS endpoint required

**CI / testing infrastructure (PR #22)**
- `vitest.config.ts` include pattern expanded from `packages/core/src/**` to `packages/**`
  — 43 test cases (compliance + anomaly + dynamic) that were silently skipped since PRs #17–#21 are now
  included in the `Unit tests (Node)` CI job on every push to `main`

### Fixed

- `approval.ts`: `SlackApprovalNotifier` — renamed `_policy` parameter to `policy` (TypeScript TS2304 — parameter was used in body but prefixed with underscore)
- `types.ts`: `AuditLogger.log()` signature changed from `Promise<void>` to `void | Promise<void>` — the interface now accepts both sync and async implementations correctly
- `approval.ts`: `ApprovalPolicy` type reconciliation — aligned `approval.ts` to use the canonical `ApprovalPolicy` from `types.ts`
- `router.ts`: Added `resolvePairAsync()` — async counterpart of `resolvePair()` closing gap G7 from the status report
- `packages/integrations/anomaly/src/index.ts`: `emitAnomaly()` now wraps `logger.log()` in `Promise.resolve()` before `.catch()` — required after `AuditLogger.log()` type was broadened to `void | Promise<void>`
- `tsconfig.json`: added `@datacules/agent-identity-anomaly` path alias pointing to `packages/integrations/anomaly/src/index.ts` — fixes TS2307 in `src/lib/anomaly.ts`

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
| `packages/python-sdk` | `datacules-agent-identity` (PyPI) | Python 3.8+ client — sync + async, Pydantic v2, zero runtime deps, CLI |

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
  - `publish-npm` — stamps all workspace `package.json` versions, builds core ESM + CJS, publishes `@datacules/*` with npm provenance
  - `publish-python` — stamps `pyproject.toml` version, builds sdist + wheel, publishes to PyPI via OIDC trusted publishing
  - `github-release` — creates GitHub Release with auto-generated notes after both publish jobs succeed
- Python SDK distribution name corrected to `datacules-agent-identity` on PyPI (was `agent-identity`, owned by a different account)
- `publish.yml`: npm publish made truly idempotent — `npm publish` output inspected for `E409`/`already exists` signals rather than relying on `npm view` (which fails under auth)
- `publish.yml`: PyPI publish switched from OIDC to twine + `PYPI_TOKEN` secret while OIDC trusted publisher is set up
- Examples directory: all 5 patterns now complete and runnable (`openai-user-delegated`, `anthropic-fixed-cred`, `hybrid-routing`, `langchain-agent`, `mcp-server`)

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
- Datacules open source license and branding
