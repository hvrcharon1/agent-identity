# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
