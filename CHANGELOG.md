# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.11.1] — 2026-06-28

### Added

- `AgentAuthMdStore` — `service_auth` registration flow and `selectMethod()` upstream-compat
  shim tracking workos/auth.md PR #15. (`packages/stores/authmd`)

  **Background:** auth.md PR #15 (open 2026-06-06) promotes the email-based registration
  path out of `identity_assertion` into a new top-level `service_auth` type with a
  CIBA-style `login_hint` body. The old wire shape
  (`{ type: 'identity_assertion', assertion_type: 'verified_email', assertion: email }`)
  is replaced by `{ type: 'service_auth', login_hint: email }`. Discovery also changes:
  `identity_assertion.assertion_types_supported` drops `'verified_email'` (ID-JAG only
  now); `identity_types_supported` gains `'service_auth'` as a new top-level entry.

  **Changes:**

  `AgentAuthMdMethod` gains `'service-auth'` member. `AgentAuthBlock` gains a
  `service_auth?: { credential_types_supported }` block. `AgentAuthMdConfig.methodPreference`
  JSDoc updated to note the new default order.

  `DEFAULT_METHOD_PREFERENCE` updated to `['id-jag', 'service-auth', 'verified-email',
  'anonymous']` — `service-auth` is inserted ahead of `'verified-email'` so post-PR#15
  services are automatically preferred without any config change.

  `selectMethod()` rewritten with a `switch` over every known `identity_types_supported`
  value. Handles three discovery shapes:
  - Simplified shorthands (`'service_auth'`, `'id-jag'`, `'verified_email'`,
    `'anonymous'` appearing directly in `identity_types_supported`) — used by test mocks
    and simple server implementations.
  - Real spec structure: `'identity_assertion'` in `identity_types_supported` with nested
    `assertion_types_supported` (`id-jag`, `verified_email`) — pre-PR#15 spec-compliant
    services. Sub-types are expanded into the supported set.
  - Post-PR#15: `'service_auth'` in `identity_types_supported` → mapped to `'service-auth'`.

  New `registerServiceAuth()` private method sends
  `{ type: 'service_auth', login_hint: userEmail, requested_credential_type: 'api_key' }`
  and stores the pending claim identically to `registerVerifiedEmail()`. The existing
  `registerVerifiedEmail()` is retained for legacy services and annotated as legacy.

  `startClaimCeremony()` error message updated to include `'service-auth'` in the list
  of methods that produce pending claims.

  New test coverage — 9 additional Vitest cases (`AgentAuthMdStore.test.ts`):
  - `service-auth flow` (5 cases): null return pending claim, correct POST body
    (`type: service_auth`, `login_hint`, no `assertion_type`/`assertion`), pending claim
    stored for `startClaimCeremony()`, null when `userEmail` missing, null on non-2xx.
  - `selectMethod() migration compat` (5 cases): prefers `service_auth` over
    `verified_email` in default preference, falls back to `verified-email` on legacy
    services, recognises `id-jag` nested inside `identity_assertion.assertion_types_supported`,
    recognises `verified_email` nested inside `identity_assertion.assertion_types_supported`,
    explicit `methodPreference` override respected.

- `CredentialRotationScheduler` enhancements — `rotateAfterUses` + grace period (PR #47)

  `isRotationDue()` is now `async` and accepts an optional `getUsageCount(credentialId)`
  callback (third constructor parameter). When supplied, rotation is triggered if either
  the elapsed time exceeds `rotateAfterDays` **or** the call count reaches `rotateAfterUses`
  — whichever comes first.

  Grace period support: after a rotation completes the old credential ref is retained in a
  `graceWindows` Map for `gracePeriodSeconds`. During that window `inGracePeriod(ref)` returns
  `true` and `getGraceRef(credentialId)` returns the old ref so routers can serve both refs
  during the handover window without interruption.

  New surface: `RotationSchedulerOptions` interface (all fields optional; fully backwards-
  compatible with the existing positional-array constructor) and static `fromOptions()` factory.

- `AzureManagedIdentityProvisioner` — Azure Managed Identity JIT provisioner for
  `@datacules/agent-identity-store-dynamic` (PR #47)

  Implements `DynamicProvisioner` alongside `VaultDynamicProvisioner` and
  `AwsRolesAnywhereProvisioner`. Supports system-assigned identities (resource URI only)
  and user-assigned identities via `clientId` or `resourceId`. Tokens are fetched from the
  Azure IMDS endpoint (`http://169.254.169.254/metadata/identity/oauth2/token`) and TTL is
  derived from `expires_in` in the token response. Configurable via `AZURE_MI_CLIENT_ID` and
  `AZURE_MI_RESOURCE` env vars when wired through `getServerStore()`.

- Server-side store wiring — Phase 3 (PR #50)

  `src/lib/server/credentialStore.ts` extended with three new factories and two new
  `CREDENTIAL_STORE_TYPE` options:

  **`getServerApprovalStore()`** — returns `LibSqlApprovalStore` when `LIBSQL_URL` is set,
  sharing the existing `_libSqlCache` client singleton, otherwise falls back to
  `MemoryApprovalStore`. Approval queues now persist across restarts and scale across
  replicas when a Turso remote URL is configured.

  **`getServerBudgetStore()`** — returns `LibSqlBudgetStore` when `LIBSQL_URL` is set
  (same singleton), otherwise falls back to `MemoryBudgetStore`.

  **`CREDENTIAL_STORE_TYPE=libsql`** — routes `getServerStore()` to `LibSqlCredentialStore`
  via the `_libSqlCache` singleton; requires `LIBSQL_URL` env var.

  **`CREDENTIAL_STORE_TYPE=dynamic`** — routes `getServerStore()` to `DynamicCredentialStore`
  with provisioner selected by `DYNAMIC_PROVISIONER=vault|aws|azure` and the corresponding
  env vars (`VAULT_DYNAMIC_MOUNT`, `VAULT_DYNAMIC_ROLE`, `AWS_ROLES_ANYWHERE_*`,
  `AZURE_MI_CLIENT_ID`, `AZURE_MI_RESOURCE`).

- `GET /api/approve/:requestId` — new Next.js route for polling a single approval request
  (`src/app/api/approve/[requestId]/route.ts`). Returns `200 { request }` or `404` from
  `getServerApprovalStore()`. Replaces optimistic client-side state in `ApprovalTab.tsx`
  for reliable cross-reload status tracking. (PR #50)

- `GET /api/budget/:credentialId/history` — new Next.js route for time-series budget data
  (`src/app/api/budget/[credentialId]/history/route.ts`). Returns per-credential hourly
  call counts and daily USD spend. Query params: `hours` (1–168, default 24), `days`
  (1–90, default 7). Degrades gracefully to empty arrays when `MemoryBudgetStore` is
  active. (PR #50)

- `LibSqlBudgetStore.listHourlyBuckets(credentialId, sinceMs)` and
  `LibSqlBudgetStore.listDailySpend(credentialId, days)` — extended methods beyond the
  `BudgetStore` interface, duck-typed by the history route for charting. Access via type
  narrowing; these are not part of the `BudgetStore` contract. (PR #50)

- `GET /api/health` — new Next.js route (`src/app/api/health/route.ts`) returning
  `{ status, version, timestamp, credentialsLoaded, rulesLoaded }`. Resolves the `404`
  that `agent-identity-cli health` received from a running server before this release.
  (PR #50, ISS-001)

- `docs/openapi.yaml` bumped to v0.10.0 — `GET /api/health` path and `HealthResponse`
  schema added; v0.9.0 and v0.10.0 change notes appended. (ISS-007)

- Server factory test suite expanded 10 → 20 cases (PR #50). New coverage:
  `CREDENTIAL_STORE_TYPE=libsql` (with and without `LIBSQL_URL`),
  `CREDENTIAL_STORE_TYPE=dynamic` with vault / aws / azure provisioners (mocked),
  unknown `DYNAMIC_PROVISIONER` fallback, `getServerApprovalStore()` Memory and LibSQL
  paths, `getServerBudgetStore()` Memory and LibSQL paths.

### Fixed

- `computeDecision()` — five bugs fixed in `packages/core/src/decision.ts` and
  `src/lib/decision.ts` (PR #49)

  1. **Context-switched path gated on Q4** — Q4 null-guard moved inside
     `variableAccess && !mixedResources`; context-switched result now resolves from Q1+Q2 alone.
  2. **Q3 (`auditRequired`) shown on variable-access paths where it has no effect** —
     `Q3.showIf` set to `variableAccess === false`; `auditRequired` null-guard moved inside
     the fixed-access branch.
  3. **`!variableAccess && mixedResources && auditRequired=true` produced same label as
     `auditRequired=false`** — distinct label and explanation added for the audit case.
  4. **Q4 `showIf` too broad** — tightened from `variableAccess === true` to
     `variableAccess === true && mixedResources === false`.
  5. **`pick()` cascade incomplete** — Q1 change now resets Q2/Q3/Q4; Q2 change resets Q3/Q4;
     Q3 change resets Q4.

  `DECISION_QUESTIONS` is now exported from `src/lib/decision` and imported by
  `DecisionTab.tsx`, making the question registry independently testable. App-layer
  test suite expanded 8 → 14 cases. (PR #49)

**Total test coverage: 475 cases across 22 packages** (+9 from v0.11.0).

---

## [0.11.0] — 2026-06-04

### Added

- `@datacules/agent-identity-store-libsql` (`packages/stores/libsql`) — LibSQL (SQLite / Turso)
  persistence layer implementing all four agent-identity store interfaces via `@libsql/client`.
  Zero native bindings, zero server, one `npm install`. Scales from embedded
  (`file:./agent-identity.db`) to globally distributed (Turso remote URL) by changing a single
  connection string — no code changes required.

  Classes and interfaces:
  - `LibSqlCredentialStore` — `CredentialStore` (`findByRef`, `listActive`, `listByKind`,
    `reserve`, `release`, `revokeByIdentity`, `upsert`)
  - `LibSqlApprovalStore` — `ApprovalStore` (`create`, `get`, `update`, `listPending`)
  - `LibSqlBudgetStore` — `BudgetStore` (hourly sliding-window counters, daily spend,
    `resetHourly`, `resetDaily`, `recordSpend`)
  - `LibSqlAuditLogger` — `MigrationAuditLogger` (`log` with standard + migration paths,
    `summarize` for per-migration compliance aggregation)
  - `createLibSqlStores()` — one-call factory: opens connection, bootstraps schema, returns
    all four stores
  - `bootstrapSchema()` — DDL runner (6 tables, 8 indexes, all `IF NOT EXISTS`)
  - `SCHEMA_DDL` — exported DDL array for custom bootstrapping

  Schema tables: `ai_credentials`, `ai_reservations`, `ai_approval_requests`,
  `ai_budget_hourly`, `ai_budget_daily`, `ai_audit_log`.

  Test suite: 32 Vitest cases (`libsql.test.ts`), all using mock client injection —
  no real SQLite connection required in CI. (PR #46)

- `packages/stores/libsql` added to npm workspaces in root `package.json` (21st workspace entry).
  `npm install` now installs `@libsql/client`; Turbo build and publish automation include the package.

- `@datacules/agent-identity-store-libsql` source alias added to `vitest.config.ts`.
  Cross-package imports resolve to `packages/stores/libsql/src/index.ts` without a prior build step.

**Total test coverage: 450 cases across 20 packages** (+32 from v0.10.0).

---

## [0.10.0] — 2026-06-03

### Added

**`packages/cli` — `@datacules/agent-identity-cli` (20th workspace package)** (PR #43)

A fully-testable TypeScript CLI package that backs the `agent-identity` commands
shown in the ComplianceTab dashboard UI. All I/O is injected via function closures
so every public function can be unit-tested without a live server or filesystem.

Published as `@datacules/agent-identity-cli`; delegates all business logic to
`@datacules/agent-identity-compliance` (`ChainVerifier`, `ComplianceReportGenerator`,
`MemoryReportStore`).

Binary: `agent-identity-cli` (renamed from `agent-identity` to avoid conflict with the
binary already registered by `@datacules/agent-identity-compliance`).

Commands:

```
agent-identity-cli audit verify --file <path> [--from <ISO>] [--to <ISO>]
  Verify the SHA-256 hash chain of a JSONL audit log. Exit 0 = intact, 1 = broken.

agent-identity-cli report soc2|gdpr|hipaa --file <path> [--from] [--to] [--format json|markdown] [--output <dir>]
  Generate a compliance report; write to stdout or a directory.

agent-identity-cli health [--url <base>]
  Check if the agent-identity server is healthy (GET /api/health).

agent-identity-cli resolve --provider <p> --user <userId> [--url <base>]
  POST /api/resolve and print the result — useful for verifying routing rules.
```

Test suite — 14 cases across 5 suites (`packages/cli/src/cli.test.ts`):
- `parseArguments` (2): positional command · --help flag
- `runAuditVerify` (4): intact chain · broken/tampered chain · unreadable file · date-range filter
- `runReport` (5): SOC2 JSON sections · GDPR piiResourceAccess · HIPAA markdown · write to disk · unreadable file
- `runHealth` (2): HTTP 200 · ECONNREFUSED
- `runResolve` (2): 200 with JSON body · 403 no matching rule

**`vitest.config.ts` — added two source aliases** (PR #43)

```
'@datacules/agent-identity-compliance' → packages/integrations/compliance/src/index.ts
'@datacules/agent-identity-audit'      → packages/audit/src/index.ts
```

Vitest resolves workspace imports to source (no build step in the test job).
Without these aliases the resolver fell back to the workspace symlink which
points to `dist/cjs/index.js` — a file that does not exist in CI.

- `AgentAuthMdStore` (`packages/stores/authmd`) — full auth.md registration
  client implementing `CredentialStore`, supporting ID-JAG, verified-email,
  and anonymous flows with OTP claim ceremony (`startClaimCeremony` /
  `completeClaimCeremony`). Backed by RFC 9728 PRM discovery.
- `CredentialStatus` extended with `'unclaimed'` tier for anonymous auth.md
  credentials pre-claim ceremony. `CredentialStatusSchema` updated to match.
- `Credential` extended with `preClaimScopes`, `postClaimScopes`, `claimedAt`,
  `claimToken` (in-memory only, never serialised).
- `CredentialStore.revokeByIdentity()` optional method for inbound revocation.
- `RevocationHandler` — inbound `logout+jwt` processor with jti replay
  protection and configurable TTL eviction. (`packages/core/src/revocation.ts`)
- `RevocationListener` — framework-agnostic HTTP handler for `revocation_uri`
  endpoints. (`packages/core/src/revocation-listener.ts`)
- `TrustedIdentityProvider` / `TrustedProviderRegistry` types and Zod schemas
  in core. (`packages/core/src/types.ts`, `packages/core/src/schemas.ts`)
- `validateIdJagClaims()` — claim-layer validation for incoming ID-JAGs,
  covering issuer trust, provider enable, expiry, audience, verified identity,
  and AMR checks. (`packages/core/src/identity-providers.ts`)
- `AsymmetricAttestationSigner` — RS256/ES256 JWT signer/verifier for ID-JAG
  compatibility, built on `crypto.subtle` with no external dependencies.
  `fromKeyPair()` for signing, `fromPublicJwk()` for verify-only instances.
- New test suites: `attestation.test.ts` (AsymmetricAttestationSigner 8 cases),
  `revocation.test.ts` (4 cases), `revocation-listener.test.ts` (6 cases),
  `identity-providers.test.ts` (12 cases), `AgentAuthMdStore.test.ts` (22 cases).
- `@datacules/agent-identity-store-authmd` added to npm workspace. (PR #45)

### Fixed

- `base64urlToBuffer()` in `attestation.ts` now returns `Uint8Array<ArrayBuffer>`
  (was `Uint8Array<ArrayBufferLike>`), resolving a TypeScript 5.5+ compile error
  where `crypto.subtle.verify()` rejected `ArrayBufferLike` as `BufferSource`. (PR #45)

- README — version badge corrected from 0.7.0 to 0.8.0; quick-start install command
  corrected to `npm install --legacy-peer-deps` to match workspace peer-dep ranges. (PR #42)

**Total test coverage: 418 cases across 19 packages** (+66 from v0.9.0).

---

## [0.9.0] — 2026-06-02

### Fixed

**Windows local-dev — webpack cache ENOENT error** (PR #41)

`next.config.js`: added a `webpack` callback that sets `cache.type = 'memory'`
when `dev === true`. Eliminates the recurring hot-reload warning on Windows:

```
[webpack.cache.PackFileCacheStrategy] Caching failed for pack: Error:
ENOENT: no such file or directory, rename '...0.pack.gz_' → '...0.pack.gz'
```

The error occurs because webpack uses an atomic rename to swap in a new cache
file, and the Next.js file watcher briefly holds a lock on the existing file
on Windows. In-memory cache avoids the rename entirely. Production builds
(`next build`) set `dev:false` and are unaffected.

**`package.json` — `clean`, `dev:clean`, `clean:modules` scripts** (PR #41)

Three new npm scripts:
- `clean` — deletes the `.next` directory with a cross-platform `fs.rmSync` one-liner.
- `dev:clean` — runs `clean` then `next dev`; shortcut for the Windows cache-clear workflow.
- `clean:modules` — deletes `node_modules` for a full fresh install.

**Total test coverage: 352 cases across 17 packages** (no change from v0.8.0).

---

## [0.8.0] — 2026-06-02

### Added

**Dashboard — five missing feature tabs (#13–#17)** (PR #39)

Five packages have been fully implemented and tested across multiple releases
(PRs #10–#22) but lacked any interactive dashboard representation. This closes
that gap by adding one tab per package and wiring them into `page.tsx`.

`src/components/RotationTab.tsx` — **tab #13 — Credential Rotation**
- Credential list with rotation-age progress bars and health badges (Healthy / Due soon / Overdue).
- Policy detail panel: rotateAfterDays, notifyBeforeDays, gracePeriodSeconds, provisioner.
- `runOnce()` simulator: streams scheduler events into a live log pane.
- Audit event reference table and code snippet for `CredentialRotationScheduler` + `VaultRotationProvider`.

`src/components/OtelTab.tsx` — **tab #14 — OpenTelemetry Tracing**
- Live span emitter; span schema reference table; backend compatibility switcher (Datadog / Honeycomb / Jaeger / X-Ray).

`src/components/JitTab.tsx` — **tab #15 — JIT Provisioning**
- Provisioner selector (Vault / AWS / Azure); live provision() simulator with TTL countdown.

`src/components/SpiffeTab.tsx` — **tab #16 — SPIFFE / SPIRE**
- Trust domain registry; `matchSpiffeId` rule matcher; active SVID certificate panel.

`src/components/ComplianceTab.tsx` — **tab #17 — Compliance**
- Report type selector (SOC 2 / GDPR / HIPAA); hash chain visualizer; CLI reference.

`src/app/page.tsx` — tab count **12 → 17**.

**CI — Windows OS test coverage** (PR #38)

`test-windows` and `smoke-windows` jobs added. Pipeline now covers ubuntu-latest and
windows-latest for both unit tests and full build + HTTP smoke test.

**`packages/core/src/router.test.ts` — expanded from 14 to 35 cases (+21)** (PR #37)

**Total test coverage: 352 cases across 17 packages** (was 331 in v0.7.0).

---

## [0.7.0] — 2026-06-02

### Added

**Dashboard — `TokenExchangeTab` (tab #12)**
**`examples/token-exchange/`** — new runnable example.
**`docs/openapi.yaml`** — bumped to v0.6.0, added `sourceCredentialId` / `targetCredentialId`.

---

## [0.6.0] — 2026-06-01

### Added

**G6 — `@datacules/agent-identity-token-exchange`** (RFC 8693). 12 Vitest cases.
**New Vitest test coverage — 34 cases (PRs #31–#33).** Total: 331 cases across 17 packages.

### Changed

`assertMigrationScope` scope enforcement, production credential store wiring, SPIFFE peerDep fix, v0.5.0 → v0.6.0 bumps.

---

## [0.5.0] — 2026-05-31

### Added

Complete Vitest test coverage for all cloud stores and audit infrastructure — 92 new cases.
Total after v0.5.0: **297 cases across 16 packages**.

---

## [0.4.0] — 2026-05-30

### Added

Fastify, NestJS, OTEL, LangChain, Express, MCP test coverage (76 cases total).
OTEL `resolvePairAsync()` fix.

---

## [0.3.0] — 2026-05-29

### Added

Dashboard `AnomalyTab` (tab #11), OpenAPI spec v0.3.0, test coverage for Phase 1–4
modules (86 cases), anomaly package (16 cases), DynamicCredentialStore (13 cases).
CI vitest.config.ts expanded to `packages/**`.

---

## [0.2.0] — 2026-05-28

Major release — Turborepo monorepo with 17 packages.

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold, CredentialRouter, provider adapters, server-side API routes
- Migration support, decision helper, CI pipeline, Datacules license
