# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.6.0] — 2026-06-01

### Added

**G6 — `@datacules/agent-identity-token-exchange` package (RFC 8693 OAuth 2.0 Token Exchange)**

The `token-exchange` auth pattern was fully represented in the routing decision tree,
`AuthPatternType`, and dashboard UI since v0.2.0, but had no concrete implementation.
Callers had to build their own OAuth 2.0 token exchange plumbing outside the framework.

`packages/integrations/token-exchange/` — new publishable package: `@datacules/agent-identity-token-exchange`

- `src/types.ts` — complete type surface:
  - `TokenExchangeConfig` — per-service exchange slot: `ref`, `name`, `kind`, `scope`, `status`,
    `tokenEndpoint`, `clientId`, `clientSecret`, `requestedScopes`, `audience`,
    `subjectTokenType`, `requestedTokenType`, `extraParams`, `provider`, `tags`.
  - `TokenExchangeResponse` — RFC 8693 success wire body: `access_token`, `issued_token_type`,
    `token_type`, `expires_in`, `scope`.
  - `SubjectTokenProvider` — `(credentialRef: string) => Promise<string | null>`.
    Implement as a closure over your request context. Returning null causes `findByRef()`
    to return null without throwing — safe for anonymous or service-to-service calls.
  - `TokenExchangeStoreOptions` — constructor bag: `configs`, `subjectTokenProvider`,
    optional `fetchFn` override.
  - `RFC_TOKEN_TYPES` — named constants for all six RFC 8693 token type URNs.

- `src/TokenExchangeStore.ts` — `CredentialStore` implementation:
  - `findByRef(ref)` — (1) looks up config; (2) checks in-memory cache (30s proactive buffer);
    (3) calls `subjectTokenProvider(ref)`; (4) POSTs RFC 8693 form body; (5) caches
    returned `access_token`; (6) returns `Credential` where `ref` IS the exchanged token.
    Returns null (never throws) on unknown ref, null subject token, non-2xx response, or
    network error.
  - `invalidateCache(ref)` — evict one cached token (call after a downstream 401).
  - `flushCache()` — evict all cached tokens.
  - No runtime dependencies beyond `@datacules/agent-identity` peer.

- `src/TokenExchangeStore.test.ts` — **12 Vitest cases** (all HTTP calls mocked via `fetchFn`):
  - Exchange flow (5): null on unknown ref; Credential with `access_token` as `ref`;
    `expiresAt` from `expires_in`; correct RFC 8693 form body; null from null provider.
  - Resilience (2): null on non-200; null without throwing on fetch rejection.
  - Caching (3): single fetch for two calls; re-exchange after `invalidateCache()`;
    re-exchange after `flushCache()`.
  - listActive / listByKind (2): active-only filter; kind filter.

- `README.md` — full usage guide: quick start, AS examples (Keycloak, Auth0, Azure AD OBO, Okta),
  cache management, TypeScript API reference.

**New Vitest test coverage — 34 cases across PRs #31–#33**

- `packages/core/src/providers.test.ts` — **12 cases** (PR #31):
  First test coverage for `packages/core/src/providers.ts`. Group 1 (6): scope field
  authoritative path — throws on read-only scope in load/rollback, warns on write scope in
  dry-run, no throw for read-only scope in extract. Group 2 (4): ref heuristic fallback when
  scope is absent — same assertions, error message includes upgrade hint. Group 3 (2):
  `injectCredential` smoke for openai and anthropic adapters.

- `src/lib/server/credentialStore.test.ts` — **10 cases** (PR #32):
  `getServerStore` (8): default/explicit memory; vault with all env vars; vault missing
  VAULT_TOKEN → memory fallback + console.warn; aws; azure with all env vars; azure
  missing AZURE_TABLES_ENDPOINT → memory fallback; singleton cache (same instance on
  second call). `getServerRules` (2): default → DEFAULT_ROUTING_RULES; ROUTING_RULES_PATH
  set → rules loaded from temp JSON file.

**Total test coverage after v0.6.0: 331 cases across 17 packages.**

### Changed

**G2 — `assertMigrationScope` scope-aware enforcement (PR #31)**

`assertMigrationScope` previously relied entirely on ref-string naming conventions
(`ref.includes('readonly') || ref.endsWith('-ro')`) to determine read-only status.
A credential named `prod-slot` passed all phase checks silently even if it was
scoped read-only at the vault level.

- `packages/core/src/types.ts`: added `scope?: string` to `ResolvedCredential`.
- `packages/core/src/router.ts`: both `resolve()` and `resolveAsync()` now populate
  `scope: cred.scope` on the returned `ResolvedCredential`.
- `packages/core/src/providers.ts`: `assertMigrationScope()` now has two enforcement paths:
  1. **Scope field (authoritative)** — when `credential.scope` is present, checked
     case-insensitively: `read-only`, `Read-only replica`, `readonly`, bare `read` → read-only;
     `write`, `read/write`, `readwrite` → write-capable. Ref heuristics skipped entirely.
  2. **Ref heuristic fallback** — when `credential.scope` is absent, prior naming-convention
     logic fires but error messages include `(naming heuristic — set Credential.scope for
     authoritative enforcement)` to nudge callers toward explicit scope.
- `src/lib/types.ts`: added `scope?: string` to dashboard-layer `ResolvedCredential` mirror.
- Non-breaking: `scope` is optional; existing deployments continue via heuristic path.

**G5 — Production server credential store wiring (PR #32)**

`src/lib/server/credentialStore.ts` was a TODO stub that always returned
`DEFAULT_CREDENTIALS` wrapped in a new `MemoryCredentialStore`, making all cloud
store packages unreachable at runtime regardless of configuration.

- `src/lib/server/credentialStore.ts` — complete rewrite:
  - `getServerStore()` factory reads `CREDENTIAL_STORE_TYPE` (memory|vault|aws|azure,
    default: memory) and returns the appropriate store as a module-level singleton.
  - Vault: checks `CREDENTIAL_STORE_URL` + `VAULT_TOKEN`; optional `VAULT_MOUNT_PATH`
    (default: `secret`) and `VAULT_PREFIX` (default: `agent-identity`).
  - AWS: dynamic import of `@datacules/agent-identity-store-aws`; optional `AWS_REGION`
    and `AWS_LOCKS_TABLE` (default: `agent-identity-locks`).
  - Azure: checks `AZURE_KEYVAULT_URL` + `AZURE_TABLES_ENDPOINT` before dynamic import.
  - All cloud paths fall back to `MemoryCredentialStore` with `console.error` on missing
    config or import failure.
  - `getServerRules()` loads from `ROUTING_RULES_PATH` JSON file when set; otherwise
    returns `DEFAULT_ROUTING_RULES`.
  - `_resetStoreCache()` exported for tests.
- `src/app/api/resolve/route.ts`: calls `getServerStore()` + `resolveAsync()` (all stores,
  approval gate, budget, attestation). Response adds `credentialId` and `expiresAt`.
- `src/app/api/migrate/resolve/route.ts`: uses `createRouterFromStore` from
  `@datacules/agent-identity` + `resolvePairAsync()` (parallel async, correct expiry).
  Response adds `sourceCredentialId` + `targetCredentialId` for traceability.
- `tsconfig.json` + `vitest.config.ts`: path aliases for all three cloud store packages.
- `.env.example`: documents all new env vars.

**G3 — SPIFFE `@datacules/agent-identity` dependency classification (PR #32)**

`packages/stores/spiffe/package.json` had `@datacules/agent-identity` listed under
`dependencies` (`*`), causing npm to install a duplicate copy alongside the consuming
app's installation. Moved to `peerDependencies` (`^0.6.0`) with `devDependencies` (`*`)
for the workspace build. Matches the pattern used by every other store and integration
package in the monorepo.

**Version bumps: 0.5.0 → 0.6.0**

- `package.json` (root monorepo): `0.5.0` → `0.6.0`
- `packages/core/package.json`: `0.5.0` → `0.6.0`
- `packages/python-sdk/pyproject.toml`: `0.5.0` → `0.6.0`
- All packages: `peerDependencies["@datacules/agent-identity"]` bumped from `^0.5.0` to `^0.6.0`
- `packages/integrations/otel/package.json`: `dependencies["@datacules/agent-identity"]`
  bumped from `^0.5.0` to `^0.6.0`
- All `examples/*/package.json`: `^0.5.0` → `^0.6.0`

---

## [0.5.0] — 2026-05-31

### Added

**Complete Vitest test coverage for all cloud stores and audit infrastructure — 92 new cases**
Total after v0.5.0: **297 cases across 16 packages**.

- `VaultCredentialStore` — 16 cases
- `AwsCredentialStore` — 16 cases
- `AzureKeyVaultCredentialStore` — 17 cases
- `SpiffeCredentialStore` — 12 cases
- `McpCredentialStore` + `McpToolCaller` — 16 cases
- Audit sinks (Console, Webhook, Datadog, Splunk, Composite) — 15 cases

---

## [0.4.0] — 2026-05-30

### Added

Fastify plugin test coverage (12 cases), NestJS integration test coverage (12 cases),
OTEL `resolvePairAsync()` fix + test coverage (13 cases), LangChain test coverage
(12 cases), Express middleware test coverage (13 cases), MCP tools test coverage (14 cases).

### Fixed

- `@datacules/agent-identity-otel`: added `resolvePairAsync()` to `TracedRouter` interface
  and `withOtel()` return object.

---

## [0.3.0] — 2026-05-29

### Added

Dashboard `AnomalyTab` (tab #11), OpenAPI spec v0.3.0 with all 9 endpoints since v0.1.0,
test coverage for Phase 1–4 modules (86 cases), anomaly package (16 cases),
DynamicCredentialStore + provisioners (13 cases). CI/testing — `vitest.config.ts`
include pattern expanded to `packages/**`.

### Fixed

- `approval.ts`: `SlackApprovalNotifier` `_policy` → `policy` parameter rename
- `types.ts`: `AuditLogger.log()` broadened to `void | Promise<void>`
- `router.ts`: added `resolvePairAsync()` async migration pair resolution
- `tsconfig.json`: added `@datacules/agent-identity-anomaly` path alias

---

## [0.2.0] — 2026-05-28

Major release — Turborepo monorepo with 17 packages across npm and PyPI.
17 publishable packages, full feature build across Phases 1–6:
  - OTEL tracing, credential rotation, zero-trust attestation, canary routing,
    JIT provisioning, approval workflows, budget management, anomaly detection,
    SPIFFE/SPIRE, verifiable audit log, compliance CLI, cross-org federation.

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter` with multi-field routing, provider adapters, server-side API routes
- Migration support: `resolvePair()`, phase-aware routing, `reserve()` / `release()`
- Decision helper, CI pipeline, Datacules open source license
