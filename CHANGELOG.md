# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**`packages/core/src/providers.test.ts` — 12 new Vitest cases**
- First test coverage for `packages/core/src/providers.ts`.
- Group 1 — `validateForMigration` with scope field (6 cases): authoritative path via `ResolvedCredential.scope`.
- Group 2 — `validateForMigration` with no scope field (4 cases): ref heuristic fallback with upgrade hint in error messages.
- Group 3 — `injectCredential` smoke (2 cases): openai + anthropic adapters.

**`src/lib/server/credentialStore.test.ts` — 10 new Vitest cases (G5)**
- `getServerStore` (8 cases): default → MemoryCredentialStore; `memory` explicit → MemoryCredentialStore;
  `vault` with all env vars → VaultCredentialStore (mocked); `vault` missing VAULT_TOKEN → memory fallback;
  `aws` → AwsCredentialStore (mocked); `azure` with all env vars → AzureKeyVaultCredentialStore (mocked);
  `azure` missing AZURE_TABLES_ENDPOINT → memory fallback; cache — same instance on second call.
- `getServerRules` (2 cases): default → DEFAULT_ROUTING_RULES; ROUTING_RULES_PATH set → rules loaded from JSON file.

### Changed

**G2 — `assertMigrationScope` hardening (PR #31)**
- `packages/core/src/types.ts`: added `scope?: string` to `ResolvedCredential`.
- `packages/core/src/router.ts`: both `resolve()` and `resolveAsync()` populate `scope: cred.scope`.
- `packages/core/src/providers.ts`: two-path scope enforcement — explicit scope field (authoritative)
  then ref-string heuristic fallback when scope is absent.
- `src/lib/types.ts`: added `scope?: string` to dashboard-layer `ResolvedCredential` mirror.

**G5 — Production server credential store wiring**

`src/lib/server/credentialStore.ts` was a stub that always returned `DEFAULT_CREDENTIALS`.
API routes re-wrapped them in a new `MemoryCredentialStore`, making the production cloud
store packages (Vault / AWS / Azure) unreachable at runtime regardless of configuration.

- `src/lib/server/credentialStore.ts` — complete rewrite:
  - New `getServerStore(): Promise<CredentialStore>` factory reads `CREDENTIAL_STORE_TYPE`
    (memory | vault | aws | azure, default: memory) and returns the appropriate store.
  - Module-level singleton per Node.js worker process. All API routes share one instance.
  - Vault: checks `CREDENTIAL_STORE_URL` + `VAULT_TOKEN` before dynamic import;
    configurable `VAULT_MOUNT_PATH` (default: `secret`) and `VAULT_PREFIX` (default: `agent-identity`).
  - AWS: dynamically imports `@datacules/agent-identity-store-aws`; optional `AWS_REGION`
    and `AWS_LOCKS_TABLE` (default: `agent-identity-locks`).
  - Azure: checks `AZURE_KEYVAULT_URL` + `AZURE_TABLES_ENDPOINT` before dynamic import.
  - All cloud paths fall back to `MemoryCredentialStore` on missing config or import failure.
  - `getServerRules()`: loads from `ROUTING_RULES_PATH` JSON file when set (Docker / K8s
    rule updates without rebuilds); falls back to `DEFAULT_ROUTING_RULES`.
  - Deprecated `getServerCredentials()` retained as thin wrapper for backward compat.
  - `_resetStoreCache()` exported for tests.

- `src/app/api/resolve/route.ts`:
  - Calls `getServerStore()` + `getServerRules()` instead of `getServerCredentials()` + manual
    `MemoryCredentialStore` construction.
  - Switches from `router.resolve(ctx)` (sync, MemoryCredentialStore only) to
    `await router.resolveAsync(ctx)` (async, all stores, approval/budget/attestation).
  - Response now includes `credentialId` and `expiresAt` in addition to `resolvedFor`.

- `src/app/api/migrate/resolve/route.ts`:
  - Replaces `import { createRouter } from '@/lib/router'` (dashboard-local, sync-only)
    with `createRouterFromStore` from `@datacules/agent-identity` (full-featured package router).
  - Calls `getServerStore()` + `getServerRules()` and `await router.resolvePairAsync(ctx)`
    (parallel async resolution, correct `expiresAt` propagation).
  - Response now includes `sourceCredentialId` + `targetCredentialId` for traceability.

- `tsconfig.json` + `vitest.config.ts`:
  - Added path aliases for `@datacules/agent-identity-store-vault`, `-store-aws`, `-store-azure`
    pointing to workspace source files. Enables TypeScript and vitest to resolve types for the
    dynamic imports in `credentialStore.ts` without a prior build step.

- `.env.example`:
  - Documents all new env vars: `CREDENTIAL_STORE_TYPE`, `VAULT_TOKEN`, `VAULT_MOUNT_PATH`,
    `VAULT_PREFIX`, `AWS_REGION`, `AWS_LOCKS_TABLE`, `AZURE_KEYVAULT_URL`,
    `AZURE_TABLES_ENDPOINT`, `ROUTING_RULES_PATH`.

**G3 — SPIFFE package `@datacules/agent-identity` dependency classification**

`packages/stores/spiffe/package.json` had `@datacules/agent-identity` listed under
`dependencies` (with `*`). This caused npm to install a second copy of the package
alongside the one already installed by the consuming app, potentially causing version
mismatches and duplicate class objects (breaking `instanceof` checks).

Moved `@datacules/agent-identity` from `dependencies` to `peerDependencies` (`^0.5.0`)
with a `devDependencies` entry (`*`) for the workspace build. This matches the pattern
used by every other store and integration package in the monorepo.

---

## [0.5.0] — 2026-05-31

### Added

**Complete Vitest test coverage for all cloud stores and audit infrastructure — 92 new cases**

Total coverage: **297 cases across 16 packages**.

See full entry in previous CHANGELOG for details on VaultCredentialStore (16),
AwsCredentialStore (16), AzureKeyVaultCredentialStore (17), SpiffeCredentialStore (12),
McpCredentialStore + McpToolCaller (16), and audit sinks (15).

---

## [0.4.0] — 2026-05-30

### Added

Fastify plugin test coverage (12 cases), NestJS integration test coverage (12 cases),
OTEL `resolvePairAsync()` fix + test coverage (13 cases), LangChain test coverage (12 cases),
Express middleware test coverage (13 cases), MCP tools test coverage (14 cases).

---

## [0.3.0] — 2026-05-29

### Added

Dashboard `AnomalyTab` (tab #11), OpenAPI spec v0.3.0, test coverage for Phase 1–4 modules
(86 cases), anomaly package (16 cases), DynamicCredentialStore + provisioners (13 cases).
CI/testing infrastructure — vitest.config.ts include pattern expanded to `packages/**`.

---

## [0.2.0] — 2026-05-28

Major release — Turborepo monorepo with 17 packages.
See full entry in previous CHANGELOG.

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter`, provider adapters, server-side API routes
- Migration support, decision helper, CI pipeline, Datacules license
