# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**G6 — `@datacules/agent-identity-token-exchange` package (RFC 8693 token exchange)**

The `token-exchange` auth pattern was fully represented in the routing decision
tree, `AuthPatternType`, and dashboard UI, but had no concrete implementation.
Callers had to build their own OAuth 2.0 token exchange plumbing outside the
framework, which defeated the purpose of the uniform `CredentialStore` interface.

`packages/integrations/token-exchange/` — new publishable package:
  `@datacules/agent-identity-token-exchange`

- `src/types.ts`
  - `TokenExchangeConfig` — per-service exchange slot definition: `ref`, `name`,
    `kind`, `scope`, `status`, `tokenEndpoint`, `clientId`, `clientSecret`,
    `requestedScopes`, `audience`, `subjectTokenType`, `requestedTokenType`,
    `extraParams`, `provider`, `tags`.
  - `TokenExchangeResponse` — RFC 8693 success body: `access_token`,
    `issued_token_type`, `token_type`, `expires_in`, `scope`.
  - `SubjectTokenProvider` — `(credentialRef: string) => Promise<string | null>`.
    Implement as a closure over your request context so the store always uses
    the current user's token. Returning null causes `findByRef()` to return null
    without throwing — safe for anonymous or service-to-service calls.
  - `TokenExchangeStoreOptions` — constructor bag: `configs`, `subjectTokenProvider`,
    optional `fetchFn` override (for tests and custom proxy clients).
  - `RFC_TOKEN_TYPES` — named constants for all six RFC 8693 token type URNs
    (`ACCESS_TOKEN`, `REFRESH_TOKEN`, `ID_TOKEN`, `SAML1`, `SAML2`, `JWT`).

- `src/TokenExchangeStore.ts` — `CredentialStore` implementation:
  - `findByRef(ref)` — (1) looks up `TokenExchangeConfig` for `ref`; (2) checks
    in-memory cache (30-second proactive refresh buffer); (3) calls
    `subjectTokenProvider(ref)`; (4) POSTs RFC 8693 form body to `tokenEndpoint`;
    (5) caches returned `access_token` with expiry from `expires_in` (default: 1h);
    (6) returns a `Credential` where `ref` IS the exchanged access_token.
    Returns null (never throws) on unknown ref, null subject token, non-2xx
    response, or network error.
  - `listActive()` — all `TokenExchangeConfig` entries with `status: 'active'`,
    returned as `Credential` objects (ref = config ref, not a live token).
  - `listByKind(kind)` — filters `listActive()` by `CredentialKind`.
  - `invalidateCache(ref)` — evicts one cached exchanged token.
    Call after a downstream 401 or a known upstream token refresh.
  - `flushCache()` — evicts all cached tokens.
    Use in test teardown or after a full re-authentication event.
  - No runtime dependencies beyond `@datacules/agent-identity` (peer).
    Uses the global `fetch` by default; injectable via `fetchFn` option.

- `src/TokenExchangeStore.test.ts` — **12 Vitest cases** (all HTTP calls mocked via
  `fetchFn` — no live AS required):
  - Exchange flow (5): null on unknown ref; Credential with `access_token` as `ref`;
    `expiresAt` computed from `expires_in`; correct RFC 8693 form body
    (`grant_type`, `subject_token`, `subject_token_type`, `client_id`,
    `client_secret`, `scope`, `audience`); null when provider returns null.
  - Resilience (2): null on non-200 response; null without throwing on
    `fetch` rejection.
  - Caching (3): single fetch for two consecutive calls (cache hit); re-exchanges
    after `invalidateCache()`; re-exchanges after `flushCache()`.
  - listActive / listByKind (2): active-only filter; kind filter.

- `README.md` — full usage guide: quick start, Auth Server examples (Keycloak,
  Auth0, Azure AD / Entra ID OBO, Okta), cache management, TypeScript API reference.

**Monorepo scaffolding for new package:**
- `package.json` (root): added `"packages/integrations/token-exchange"` to `workspaces`.
- `tsconfig.json` (root): added path alias
  `"@datacules/agent-identity-token-exchange"` → `packages/integrations/token-exchange/src/index.ts`.
- `vitest.config.ts`: added same alias to the resolver so test files can import
  the package without a prior build step.

---

**`packages/core/src/providers.test.ts` — 12 Vitest cases (PR #31)**
- Group 1: `validateForMigration` with scope field (6 cases) — authoritative path.
- Group 2: `validateForMigration` with no scope field (4 cases) — ref heuristic fallback.
- Group 3: `injectCredential` smoke (2 cases).

**`src/lib/server/credentialStore.test.ts` — 10 Vitest cases (PR #32)**
- `getServerStore` (8 cases): default/explicit memory; vault / vault-missing-token fallback;
  aws; azure / azure-missing-endpoint fallback; singleton cache.
- `getServerRules` (2 cases): default rules; rules loaded from JSON file.

### Changed

**G2 — `assertMigrationScope` hardening (PR #31)**
- `packages/core/src/types.ts`: added `scope?: string` to `ResolvedCredential`.
- `packages/core/src/router.ts`: `resolve()` and `resolveAsync()` both populate
  `scope: cred.scope` on the returned `ResolvedCredential`.
- `packages/core/src/providers.ts`: two-path enforcement in `assertMigrationScope` —
  explicit scope field (authoritative, case-insensitive) then ref-string heuristic
  fallback (with upgrade-hint error messages).
- `src/lib/types.ts`: added `scope?: string` to dashboard-layer `ResolvedCredential`.

**G5 — Production server credential store wiring (PR #32)**
- `src/lib/server/credentialStore.ts`: complete rewrite — `getServerStore()` factory
  reads `CREDENTIAL_STORE_TYPE` (memory|vault|aws|azure) and returns the appropriate
  cloud store singleton; `getServerRules()` loads from `ROUTING_RULES_PATH` JSON file.
- `src/app/api/resolve/route.ts`: uses `getServerStore()` + `resolveAsync()`.
- `src/app/api/migrate/resolve/route.ts`: uses `getServerStore()` + `resolvePairAsync()`.
- `tsconfig.json` + `vitest.config.ts`: path aliases for all three cloud store packages.
- `.env.example`: documents all new env vars.

**G3 — SPIFFE package peerDependencies fix (PR #32)**
- `packages/stores/spiffe/package.json`: moved `@datacules/agent-identity` from
  `dependencies` to `peerDependencies` (`^0.5.0`) + `devDependencies` (`*`).

---

## [0.5.0] — 2026-05-31

### Added

**Complete Vitest test coverage for all cloud stores and audit infrastructure — 92 new cases**
Total coverage after v0.5.0: **297 cases across 16 packages**.

- `VaultCredentialStore` — 16 cases
- `AwsCredentialStore` — 16 cases
- `AzureKeyVaultCredentialStore` — 17 cases
- `SpiffeCredentialStore` — 12 cases
- `McpCredentialStore` + `McpToolCaller` — 16 cases
- Audit sinks (`ConsoleAuditLogger`, `WebhookAuditLogger`, `DatadogAuditLogger`,
  `SplunkAuditLogger`, `CompositeAuditLogger`) — 15 cases

---

## [0.4.0] — 2026-05-30

### Added

Fastify plugin test coverage (12 cases), NestJS integration test coverage (12 cases),
OTEL `resolvePairAsync()` fix + test coverage (13 cases), LangChain test coverage
(12 cases), Express middleware test coverage (13 cases), MCP tools test coverage
(14 cases).

---

## [0.3.0] — 2026-05-29

### Added

Dashboard `AnomalyTab` (tab #11), OpenAPI spec v0.3.0, test coverage for Phase 1–4
modules (86 cases), anomaly package (16 cases), DynamicCredentialStore + provisioners
(13 cases). CI/testing infrastructure — vitest.config.ts expanded to `packages/**`.

---

## [0.2.0] — 2026-05-28

Major release — Turborepo monorepo with 17 packages across npm and PyPI.
See full entry in previous CHANGELOG for complete details.

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter` with multi-field routing, provider adapters, server-side API routes
- Migration support: `resolvePair()`, phase-aware routing, `reserve()` / `release()`
- Decision helper, CI pipeline, Datacules open source license
