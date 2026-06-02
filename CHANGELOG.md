# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**`packages/cli` — `@datacules/agent-identity-cli` (19th workspace package)** (PR #43)

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

**`public/logo.svg` + `src/app/layout.tsx` + `src/app/page.tsx` — logo footprint**

- `public/logo.svg`: static copy of `assets/logo.svg` served by Next.js at `/logo.svg`.
- `src/app/layout.tsx`: added `icons` (favicon, apple-touch) and `openGraph` metadata
  pointing to `/logo.svg`; browser tabs, link-preview cards, and OG scrapers now display
  the brand mark.
- `src/app/page.tsx`: replaced the generic `IconCpu` chip + `<h1>` header with the full
  logo wordmark (`<img src="/logo.svg" class="h-12">`); kept an `sr-only` `<h1>` for
  screen-reader and SEO accessibility.

**All guiding documents — logo header + content refresh**

- `CONTRIBUTING.md`: logo header; fixed provider/type paths from stale `src/lib/` to
  `packages/core/src/`; added `validateForMigration` to the adapter example; added
  monorepo layout section and vitest alias note for new packages.
- `docs/credential-routing.md`: logo header; updated router path; full rule-matching
  dimension table; canary, migration, SPIFFE, and `resolvePair` examples.
- `docs/patterns.md`: logo header; expanded from 4 to 6 named patterns (adds Token
  exchange / RFC 8693 and Data migration / phase-aware); decision tree.
- `docs/provider-integration.md`: logo header; fixed provider path; added
  `validateForMigration` to adapter template; added OTEL span attribute table.
- `packages/cli/README.md`: logo header; corrected binary name to `agent-identity-cli`;
  added architecture note about injection-based testability.

**Total test coverage: 366 cases across 19 packages** (was 352 in v0.8.0).

### Fixed

**Windows local-dev — webpack cache ENOENT error** (PR #41)

`next.config.js`: added a `webpack` callback that sets `cache.type = 'memory'`
when `dev === true`. Eliminates the recurring hot-reload warning on Windows.

**`package.json` — `clean`, `dev:clean`, `clean:modules` scripts** (PR #41–#42)

**README — version badge 0.7.0 → 0.8.0 and `--legacy-peer-deps` install flag** (PR #42)

**PR #43 CI — three root-cause failures diagnosed and resolved**

The unit test jobs (`Unit tests (Linux)` and `Unit tests (Windows)`) were failing on
the initial PR #43 commit. Root cause analysis identified three independent failures:

1. **`vitest.config.ts` missing alias for `@datacules/agent-identity-compliance`** —
   Vitest resolved the workspace symlink to `dist/cjs/index.js`, which does not exist
   in CI (no build step runs before the test job). Fixed: source alias added (see Added
   section above). The `@datacules/agent-identity-audit` alias was also missing and
   added at the same time.

2. **`packages/cli` absent from root `workspaces`** — The CLI package was not a proper
   npm workspace member; `npm install` did not symlink it or register its dependencies.
   Fixed: `"packages/cli"` added to the `workspaces` array in the root `package.json`.

3. **Wrong compliance dep version `"^0.8.0"` in `packages/cli/package.json`** — The
   compliance package is at `0.2.0`; the semver range `^0.8.0` never resolves inside
   the workspace. Fixed: changed to `"*"` so npm always resolves to the local workspace
   version regardless of individual package versions.

All three fixes were committed to `feat/cli-package` and CI passed on the corrected
head (Python SDK: 11 s; Linux unit tests; Windows unit tests; build + smoke).

---

## [0.8.0] — 2026-06-02

### Added

**Dashboard — five missing feature tabs (#13–17)** (PR #39)

Five packages have been fully implemented and tested across multiple releases
(PRs #10–#22) but lacked any interactive dashboard representation. This closes
that gap by adding one tab per package and wiring them into `page.tsx`.

`src/components/RotationTab.tsx` — **tab #13 — Credential Rotation**
- Credential list with rotation-age progress bars and health badges (Healthy / Due soon / Overdue).
- Policy detail panel: rotateAfterDays, notifyBeforeDays, gracePeriodSeconds, provisioner.
- `runOnce()` simulator: streams scheduler events into a live log pane — check → mint → store → grace period → revoke.
- Audit event reference table: `credential.rotated`, `credential.rotation_due`, `credential.rotation_failed`.
- Code snippet for `CredentialRotationScheduler` + `VaultRotationProvider` setup.

`src/components/OtelTab.tsx` — **tab #14 — OpenTelemetry Tracing**
- Live span emitter: `router.resolveAsync(ctx)` button streams `agent_identity.store.get`,
  `agent_identity.resolve_async`, and `agent_identity.audit.emit` spans into a trace pane
  with timing and all attributes visible inline.
- Span schema reference table (resolve / resolve_async / resolve_pair / resolve_pair_async).
- Span attributes grid with example values for all 12 attributes.
- Backend compatibility switcher: Datadog APM / Honeycomb / Jaeger / AWS X-Ray.
- Code snippet for `withOtel()` wrapper setup.

`src/components/JitTab.tsx` — **tab #15 — JIT Provisioning**
- Provisioner selector: Vault Dynamic Secrets / AWS IAM Roles Anywhere / Azure Managed Identity.
- Live provision() simulator with real-time TTL countdown bar (cache miss → cached → expired → re-provision).
- Per-provisioner code snippets showing exact constructor configuration.
- How-it-works step list explaining the findByRef → cache check → provision → cache → expire flow.

`src/components/SpiffeTab.tsx` — **tab #16 — SPIFFE / SPIRE**
- Trust domain registry with SPIFFE ID pattern list (two demo domains).
- `matchSpiffeId` rule matcher: type any workload SPIFFE ID, click Match, see which routing rule fires.
- Active SVID certificate panel: Subject URI SAN, not-before/after, serial, signature algorithm,
  auto-renew-at timestamp, and a TTL progress bar.
- Code snippet for `SpiffeCredentialStore` + routing rule with `matchSpiffeId` glob pattern.

`src/components/ComplianceTab.tsx` — **tab #17 — Compliance**
- Report type selector: SOC 2 CC6 / GDPR Article 30 / HIPAA §164.312.
- `generator.generate()` button produces a sample JSON report; section tabs let the user
  browse agentAccessSummary, piiResourceAccess, credentialRotationHistory, anomalyEvents.
- Hash chain visualizer: 4-entry chain with SHA-256 hash and prevHash annotations;
  explains that modifying any entry breaks all subsequent hashes.
- CLI reference: `agent-identity-cli audit verify` and `agent-identity-cli report soc2/gdpr/hipaa`.
- Code snippet for `ComplianceReportGenerator` + `HashChainAuditLogger` setup.

`src/app/page.tsx` — wiring
- 5 new imports (RotationTab, OtelTab, JitTab, SpiffeTab, ComplianceTab).
- 5 new inline SVG icon functions (IconRefreshCw, IconActivity, IconDatabase, IconLock2, IconFileText).
- 5 new entries in the TABS `as const` array (tabs #13–17).
- 5 new `activeTab` render conditions.
- Tab count: **12 → 17**.

`README.md` — documentation
- Dashboard section: “Twelve” → “Seventeen” interactive tabs.
- Tab table: 5 new rows (Rotation, OTEL tracing, JIT provisioning, SPIFFE/SPIRE, Compliance).
- Project structure annotation: `(12 tabs)` → `(17 tabs)`.

**CI — Windows OS test coverage** (PR #38)

Two new GitHub Actions jobs extend the pipeline from 6 to 8 jobs,
running the full test suite and Next.js application on `windows-latest`
in addition to the existing `ubuntu-latest` coverage:

- **`test-windows`** (`Unit tests (Windows)`) — runs all 352 Vitest cases
  on `windows-latest` using `shell: bash` (Git Bash) throughout, keeping
  commands identical to the Linux `test` job. Runs in parallel with the
  Linux unit test job.

- **`smoke-windows`** (`Build + smoke test (Windows)`) — full Next.js
  production build and HTTP smoke test on `windows-latest`. Restores the
  OS-agnostic `core-dist` artifact built by `build-packages`, runs
  `npm run build`, then starts `npx next start --port 3000` in the
  background within a single bash step and polls `localhost:3000` via
  `curl` for up to 90 s. Asserts HTTP 200 and that the response body
  contains the `agent` content marker. Gates on both Linux and Windows
  unit tests passing.

The `build-and-smoke` (Linux) smoke job now also lists `test-windows`
in its `needs` array, so both platforms' unit tests must be green before
either smoke job runs. Job display names updated: `Unit tests (Node)` →
`Unit tests (Linux)` and `Build + smoke test` → `Build + smoke test (Linux)`
for clarity in the GitHub Actions summary panel.

**`packages/core/src/router.test.ts` — expanded from 14 to 35 cases (+21)** (PR #37)

Ten new describe groups fill all previously uncovered `CredentialRouter` code paths:

- **Canary routing** (4 cases) — `Math.random`-seeded tests confirm that `canaryWeight: 0`
  always returns the primary credential, `canaryWeight: 100` always returns the canary,
  and `canaryWeight: 50` splits correctly at the boundary. Both `credentialId` and
  `isCanary` are asserted on every path.
- **Expiry enforcement** (3 cases) — expired credential (`expiresAt` 1 minute ago) returns
  null; future expiry resolves; absent `expiresAt` resolves (no expiry check fires).
- **`readOnly` scope enforcement** (2 cases) — `readOnly: true` with scope `'read:write'`
  (includes 'read') resolves; scope `'write'` (no 'read') returns null.
- **Audit logger** (1 case) — `logger.log()` called exactly once; entry fields
  (`credentialId`, `userId`, `action`, `traceId`) match the context and resolution.
- **Budget enforcer** (2 cases) — `allowed: true` resolves and `check()` is called;
  `allowed: false` returns null and `check()` is still called once.
- **Approval gate** (3 cases) — `'approved'` resolves to `cred-linear`, `'rejected'`
  returns null, `'break_glass'` resolves (emergency override). All paths verify
  `request()` is called exactly once.
- **Attestation signer** (2 cases) — `attestationSigner` configured: `credentialAttestation`
  is a defined string and `sign()` is called once; no signer: `credentialAttestation`
  is `undefined`.
- **`matchSpiffeId` rule matching** (2 cases) — context SPIFFE ID equal to
  `rule.matchSpiffeId` resolves to the expected credential; a different SPIFFE ID returns null.
- **`isSyncCapable` guard** (1 case) — calling `resolve()` on an async-only store (no
  `findByRefSync` method) returns null and emits a `console.warn` containing
  `'findByRefSync'`.
- **`createRouterWithConfig` factory** (1 case) — attestation signer and logger both
  configured simultaneously; a single `resolveAsync()` call fires both `sign()` and
  `log()` exactly once.

All mocks use `vi.fn()` (Vitest). `ApprovalManager` and `BudgetEnforcer` are mocked
via `as unknown as T` — no live approval servers, budget stores, or token endpoints
required. `Math.random` is spied on and restored after each canary test via
`vi.restoreAllMocks()`.

**Total test coverage: 352 cases across 17 packages** (was 331 in v0.7.0).

---

## [0.7.0] — 2026-06-02

### Added

**Dashboard — `TokenExchangeTab` (tab #12)**

`src/components/TokenExchangeTab.tsx` — full interactive token exchange dashboard:
- 5-step exchange flow diagram: Agent request → SubjectTokenProvider → RFC 8693 POST → AS returns token → Credential returned.
- 3 pre-configured exchange slots: CRM Service (user-delegated, Keycloak), Analytics
  (fixed, Auth0), Data Warehouse (user-delegated, Azure AD OBO).
- Interactive `findByRef()` simulator: enter a subject token, click Run exchange, see
  the resolved Credential with `credentialId`, `kind`, `scope`, `resolvedFor`, `expiresAt`,
  and `ref` (exchanged access_token, truncated for safety).
- Cache state indicator: first call shows fresh exchange; subsequent calls show
  `cache hit` badge + latency; `invalidateCache()` button clears the cache and resets.
- Authorization Server switcher: Keycloak / Auth0 / Azure AD / Okta — each shows its
  token endpoint pattern and any AS-specific configuration note.
- Generated TypeScript code snippet: shows the exact `TokenExchangeStore` configuration
  for the selected AS and exchange slot. Copy button included.
- Cache behaviour reference grid: cache miss / hit / invalidateCache / flushCache —
  explains when each path fires and when to call each method.
- Explainer: how the store integrates with `createRouterFromStore`, why no long-lived
  secrets are stored, and how the exchanged token is injected server-side.

`src/app/page.tsx`:
- Import `TokenExchangeTab` from `@/components/TokenExchangeTab`.
- Added tab #12: `{ id: 'token-exchange', label: 'Token exchange', Icon: IconRepeat }`
  with a swap-arrows SVG icon.
- Render `<TokenExchangeTab />` when `activeTab === 'token-exchange'`.

**`examples/token-exchange/`** — new runnable example:
- Demonstrates `TokenExchangeStore` wired via `createRouterFromStore` with a Keycloak
  token endpoint.
- 3-step flow: cache miss (HTTP exchange), cache hit (no HTTP), `invalidateCache()` +
  fresh re-exchange. Logs latency and ref identity to stdout.
- `package.json` references `@datacules/agent-identity-token-exchange ^0.1.0`.

**`docs/openapi.yaml`** — bumped to v0.6.0:
- `info.version`: `0.3.0` → `0.6.0`.
- `MigrateResolveResponse`: added `sourceCredentialId` and `targetCredentialId` as
  **required** response fields. These were added to the route handler in PR #32 but
  were missing from the spec. Both fields now carry inline descriptions explaining
  their traceability purpose.
- `ResolveResponse`, `MigrateResolveRequest`, and all other schemas: unchanged
  (already correct since v0.3.0).
- `/api/migrate/resolve` description: notes the v0.6.0 addition of the two new
  credential ID fields.

---

## [0.6.0] — 2026-06-01

### Added

**G6 — `@datacules/agent-identity-token-exchange` package (RFC 8693 OAuth 2.0 Token Exchange)**

`packages/integrations/token-exchange/` — new publishable package.
`TokenExchangeStore` implements `CredentialStore`. On `findByRef()` exchanges the
caller's subject token for a scoped downstream token at any RFC 8693-compliant AS.
12 Vitest cases. README with Keycloak / Auth0 / Azure AD / Okta examples.

**New Vitest test coverage — 34 cases (PRs #31–#33)**
- `packages/core/src/providers.test.ts` — 12 cases (scope-field + heuristic + inject smoke)
- `src/lib/server/credentialStore.test.ts` — 10 cases (store factory + rules loader)
- `packages/integrations/token-exchange/src/TokenExchangeStore.test.ts` — 12 cases

**Total test coverage: 331 cases across 17 packages.**

### Changed

**G2 — `assertMigrationScope` scope-aware enforcement** (PR #31)
**G5 — Production server credential store wiring** (PR #32)
**G3 — SPIFFE `@datacules/agent-identity` peerDependencies fix** (PR #32)
**Version bumps: 0.5.0 → 0.6.0** (PR #34)

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
