# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**CI — Windows OS test coverage** (`.github/workflows/ci.yml`)

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

---

## [0.7.0] — 2026-06-02

### Added

**`packages/core/src/router.test.ts` — expanded from 14 to 35 cases (+21)**

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

**Total test coverage: 352 cases across 17 packages** (was 331).

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
