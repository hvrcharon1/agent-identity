# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
- `@datacules/agent-identity-store-authmd` added to npm workspace.

### Fixed

- `base64urlToBuffer()` in `attestation.ts` now returns `Uint8Array<ArrayBuffer>`
  (was `Uint8Array<ArrayBufferLike>`), resolving a TypeScript 5.5+ compile error
  where `crypto.subtle.verify()` rejected `ArrayBufferLike` as `BufferSource`.

---

## [0.9.0] — 2026-06-03

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

**Total test coverage: 366 cases across 19 packages** (was 352 in v0.8.0).

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

**`package.json` — `clean`, `dev:clean`, `clean:modules` scripts** (PR #41–#42)

Three new npm scripts:
- `clean` — deletes the `.next` directory with a cross-platform `fs.rmSync` one-liner.
- `dev:clean` — runs `clean` then `next dev`; shortcut for the Windows cache-clear workflow.
- `clean:modules` — deletes `node_modules` for a full fresh install.

**README — version badge 0.7.0 → 0.8.0 and `--legacy-peer-deps` install flag** (PR #42)

Version badge in README corrected from 0.7.0 to 0.8.0. Quick-start install command
corrected to `npm install --legacy-peer-deps` to match the workspace peer-dep ranges.

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
