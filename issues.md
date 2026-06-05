# Issues — agent-identity

> Known bugs, errors, glitches, and gaps requiring resolution.
> Each issue includes severity, affected components, root cause, and a recommended fix.

## Severity Key

| Icon | Level | Meaning |
|------|-------|---------|
| 🔴 | Critical | Blocking, data-integrity risk, or silent incorrect behaviour at runtime |
| 🟠 | High | Significant functionality gap or user-facing failure with no workaround |
| 🟡 | Medium | Unexpected behaviour with a workaround, or a pattern that will cause future bugs |
| 🟢 | Low | Minor polish, documentation gap, or edge-case that does not affect normal operation |

---

## [ISS-001] 🔴 Missing `GET /api/health` route

**Status**: Resolved — `src/app/api/health/route.ts` created; `docs/openapi.yaml` updated to v0.10.0
**Affects**: `@datacules/agent-identity-cli` — `agent-identity-cli health` command
**Introduced**: PR #43 (v0.9.0)

### Description

The CLI package ships a `health` command that performs `GET <base>/api/health` against a running agent-identity server and returns the response status. However, no corresponding Next.js route handler existed in `src/app/api/`. Any invocation of `agent-identity-cli health` would receive an HTTP `404 Not Found` from the Next.js app and the CLI would report the server as unreachable, even when it was fully operational.

The MCP server's `health` tool (in `packages/integrations/mcp/src/tools.ts`) correctly returns a health object, but this is a different code path and is only reachable via the MCP protocol, not via HTTP.

### Root Cause

The `runHealth()` function in `packages/cli/src/cli.ts` was written before the server-side route was created. The route was never added to `src/app/api/`.

### Fix Applied

Created `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerStore, getServerRules } from '@/lib/server/credentialStore';

export async function GET() {
  const [store, rules] = await Promise.all([getServerStore(), getServerRules()]);
  const credentials = await store.listActive();
  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version ?? 'unknown',
    timestamp: new Date().toISOString(),
    credentialsLoaded: credentials.length,
    rulesLoaded: rules.length,
  });
}
```

Also added `GET /api/health` and `HealthResponse` schema to `docs/openapi.yaml` (bumped to v0.10.0).

---

## [ISS-002] 🟠 PR #48 is open and stale (superseded by PR #49)

**Status**: Resolved — PR #48 closed with reference to #49
**Affects**: GitHub repository hygiene, contributor confusion
**PR**: [#48](https://github.com/hvrcharon1/agent-identity/pull/48) — `feat/fix-decision-helper-app`

### Description

PR #48 (`fix(decision): sync app-layer helper with core package — 5 bugs + test expansion`) was opened on 2026-06-05 and was still in **open** state. It was superseded by PR #49 (`fix(decision): sync app-layer helper with core — 5 bugs + test expansion`, branch `feat/fix-decision-helper-app-v2`) which was merged the same day. The work in PR #49 is a superset of PR #48.

Leaving PR #48 open creates confusion for contributors reviewing the PR queue and may be mistakenly rebased and re-submitted as a duplicate fix.

### Fix Applied

Closed PR #48 with the comment: *“Superseded by #49 (`feat/fix-decision-helper-app-v2`), which carried the full implementation (3 files, +214/−129) and was merged. This branch only contained a 1-line comment removal. Closing.”*

---

## [ISS-003] 🟠 Phase 3 branch (`feat/phase3-jit-approvals`) has no commits

**Status**: Open
**Affects**: Planned Phase 3 feature completeness (see `enhancements.md`)

### Description

The branch `feat/phase3-jit-approvals` was created as the target for Phase 3 implementation (JIT provisioning via `DynamicCredentialStore`, server-side `ApprovalTab` and `BudgetTab` API routes, and the missing `GET /api/health` route). The branch was created but no commits have been pushed to it.

As a result, three dashboard tabs (`ApprovalTab`, `BudgetTab`, `JitTab`) display interactive UI that is not connected to persistent server-side state — all approval and budget data resets on server restart and is not shared across multiple server instances.

### Affected components

- `src/components/ApprovalTab.tsx` — approval queue is in-memory only
- `src/components/BudgetTab.tsx` — budget counters are in-memory only
- `src/components/JitTab.tsx` — provisioner simulator is mock-only (no real DynamicCredentialStore server wiring)
- `src/app/api/approve/` — uses `MemoryApprovalStore` (not `LibSqlApprovalStore`)
- `src/app/api/budget/` — uses in-memory counters (not `LibSqlBudgetStore`)

### Fix

Implement Phase 3 per the `enhancements.md` v0.11.0 plan. Priority order:
1. Server-side `LibSqlApprovalStore` wiring for approval routes
2. Server-side `LibSqlBudgetStore` wiring for budget routes
3. `CREDENTIAL_STORE_TYPE=dynamic` in `getServerStore()`

---

## [ISS-004] 🟡 `[Unreleased]` CHANGELOG features not reflected in README

**Status**: Open
**Affects**: `README.md`, developer onboarding

### Description

The `[Unreleased]` block in `CHANGELOG.md` documents significant features merged to `main` since v0.9.0 that are not yet reflected in the README:

| Feature | Merged via | README status |
|---------|-----------|---------------|
| `@datacules/agent-identity-store-libsql` | PR #46 | ✅ Listed in packages table |
| auth.md enhancements G-A1–G-A6 | PR #45 | ⚠️ Partially documented |
| `RevocationHandler` / `RevocationListener` classes | PR #45 | ❌ Not mentioned |
| `validateIdJagClaims()` function | PR #45 | ❌ Not mentioned |
| `unclaimed` CredentialStatus tier | PR #45 | ❌ Not mentioned |
| `rotateAfterUses` + grace period in rotation scheduler | PR #47 | ❌ Not mentioned |
| `AzureManagedIdentityProvisioner` class name | PR #47 | ❌ Not named (generic mention only) |
| Decision helper 5-bug fix | PR #49 | ❌ Not mentioned |

The auth.md store code block also contains a misleading comment:
```
// Inbound logout+jwt revocation is handled automatically — no extra wiring required
```
This is incorrect. The `RevocationListener` must be explicitly mounted at the `revocation_uri` endpoint for inbound revocation to function.

### Fix

Update README.md to address the above gaps and cut a formal v0.10.0 release tag that promotes the `[Unreleased]` CHANGELOG block, updates all workspace `package.json` version fields, and triggers the publish workflow.

---

## [ISS-005] 🟡 App-layer logic divergence pattern

**Status**: Partially resolved (PR #49 merged)
**Affects**: `src/lib/decision.ts`, `src/components/DecisionTab.tsx` vs `packages/core/src/decision.ts`

### Description

The Next.js app (`src/`) maintains its own copies of several logic files that mirror implementations in `packages/core/src/`. When the core package is updated, the app-layer copies can silently fall behind. This pattern was the root cause of the five decision helper bugs fixed in PR #49 — the core package had been updated correctly but the app-layer copies were not synchronised.

Known mirrored files:

| App-layer file | Core package mirror | Sync mechanism |
|----------------|---------------------|------------------|
| `src/lib/decision.ts` | `packages/core/src/decision.ts` | Manual — PR #49 fixed divergence; `DECISION_QUESTIONS` now imported from app-layer |
| `src/lib/router.ts` | `packages/core/src/router.ts` | Manual — `src/lib/router.ts` is a simplified subset |
| `src/lib/types.ts` | `packages/core/src/types.ts` | Manual — known to intentionally lag (all new fields optional) |
| `src/lib/providers.ts` | `packages/core/src/providers.ts` | Manual |

### Fix

For `decision.ts` specifically: the `DECISION_QUESTIONS` constant and `computeDecision()` function should be re-exported from `packages/core` and imported by `src/lib/decision.ts` rather than maintained in parallel. PR #49 exported `DECISION_QUESTIONS` from the app-layer `src/lib/decision.ts`; the next step is to eliminate the app-layer copy entirely and import from `@datacules/agent-identity`.

For `router.ts` and `providers.ts`: consider whether the app-layer copies are actually needed or whether `createRouterFromStore()` from `@datacules/agent-identity` can replace them entirely (as was done for the API routes in PR #32).

---

## [ISS-006] 🟡 Windows webpack ENOENT cache issue (mitigated, not eliminated)

**Status**: Mitigated (PR #41)
**Affects**: Windows local development workflow
**Mitigation**: `next.config.js` sets `cache.type = 'memory'` in dev mode

### Description

The webpack filesystem cache causes an intermittent ENOENT error on Windows during hot-reload:

```
[webpack.cache.PackFileCacheStrategy] Caching failed for pack: Error:
ENOENT: no such file or directory, rename
'.next\cache\webpack\...\0.pack.gz_' -> '.next\cache\webpack\...\0.pack.gz'
```

This occurs because the Next.js file watcher briefly holds a lock on `0.pack.gz` while webpack attempts an atomic rename. PR #41 switched the dev cache to `type: 'memory'`, which eliminates the rename. However, the memory cache is per-process — in scenarios with multiple concurrent webpack processes (e.g., running `turbo dev` with multiple packages), the issue may resurface.

### Remaining risk

- The `dev:clean` script (`npm run dev:clean`) provides a manual recovery path
- The in-memory cache does not persist across process restarts, slightly increasing cold-start time on Windows
- If a future Next.js upgrade changes the dev server process model, the fix may need revisiting

### Fix (if issue resurfaces)

Upgrade to Next.js 15+ which uses Rspack instead of webpack by default, eliminating the atomic-rename issue at the cache layer level.

---

## [ISS-007] 🟡 `docs/openapi.yaml` is missing 5 endpoints and is stale at v0.6.0

**Status**: Resolved — `GET /api/health` added and spec bumped to v0.10.0; audit confirmed the other 4 endpoints cited were already present in the spec prior to this fix
**Affects**: `docs/openapi.yaml`, API consumers using the spec

### Description

The OpenAPI spec was last updated in PR #35 (v0.7.0) and was pinned at spec version `0.6.0`. On audit, the following endpoints were checked:

| Endpoint | Route file | Status in spec |
|----------|-----------|----------------|
| `GET /api/health` | `src/app/api/health/route.ts` (created this session) | ✅ Added (v0.10.0) |
| `POST /api/approve/break-glass` | `src/app/api/approve/` | ✅ Already present |
| `DELETE /api/anomaly` | `src/app/api/anomaly/` | ✅ Already present |
| `GET /api/budget` | `src/app/api/budget/` | ✅ Already present |
| `POST /api/budget` (reset counter) | `src/app/api/budget/` | ✅ Already present |

Additionally, `MigrateResolveResponse` in the spec was verified to include `sourceCredentialId` and `targetCredentialId` (added in v0.6.0 alongside PR #32) — no drift found.

### Fix Applied

Added `GET /api/health` path and `HealthResponse` schema to `docs/openapi.yaml`. Spec version bumped to `0.10.0` with v0.9.0 and v0.10.0 change notes. Long-term: adopt `zod-to-openapi` to auto-generate the spec from the existing Zod schemas in `packages/core/src/schemas.ts`, eliminating manual drift.

---

## [ISS-008] 🟡 `@datacules/agent-identity-cli` binary resolves `agent-identity` name collision on some npm versions

**Status**: Mitigated (PR #43 renamed binary; CONTRIBUTING.md updated this session)
**Affects**: Users who install both `@datacules/agent-identity-compliance` and `@datacules/agent-identity-cli` globally

### Description

Before PR #43, the CLI binary was registered as `agent-identity` in `packages/cli/package.json`. The `@datacules/agent-identity-compliance` package also registers a `bin/cli.js` entry. On npm v7+ with strict hoisting, globally installing both packages could result in one binary overwriting the other silently.

PR #43 renamed the CLI binary to `agent-identity-cli` to avoid the collision. However, any documentation or tooling that references the old `agent-identity` binary name (rather than `agent-identity-cli`) will break.

### Remaining risk

Check that no CI scripts, CI smoke tests, or internal docs reference the old `agent-identity` binary name. `CONTRIBUTING.md` now documents the correct binary name `agent-identity-cli` with usage examples.

---

## [ISS-009] 🟢 Missing API route test coverage (`src/app/api/`)

**Status**: Open
**Affects**: CI confidence for the Next.js server layer

### Description

The `packages/` test suite has 466 Vitest cases covering all published packages. However, the Next.js API routes in `src/app/api/` have no automated test coverage. The server-layer code paths (credential store wiring, route validation, error handling) are only tested via the end-to-end smoke test (HTTP 200 + body check), which does not verify:

- 400 validation errors on malformed request bodies
- 403 responses when no credential matches
- Correct `resolvedFor` / `credentialId` / `expiresAt` in the response body
- Migration `resolvePair()` response shape
- Approval and budget enforcement in the resolve path
- Health route response shape and store wiring

### Fix

Add a `src/app/api/__tests__/` directory with Vitest tests using `next/server`'s `NextRequest` mock. The pattern used in `packages/integrations/express/src/express.test.ts` (mocking the store and calling the handler directly) is applicable here.

---

## [ISS-010] 🟢 `packages/python-sdk` mock patch path assumption is fragile

**Status**: Resolved — `test_client.py` audited; all `@patch` decorators correctly target `urllib.request.urlopen`; no `agent_identity.<stdlib>` patterns found
**Affects**: `packages/python-sdk/tests/`

### Description

At some point during CI debugging (documented in session history), the Python SDK test suite used an incorrect mock patch path:

```python
# Wrong
@patch("agent_identity.urllib.request.urlopen")

# Correct
@patch("urllib.request.urlopen")
```

The correct path was identified and applied. The test suite was audited in full — all 15 `@patch` calls in `test_client.py` use `urllib.request.urlopen` (the correct stdlib path). No `agent_identity.<stdlib>` patterns exist in the test file.

---

## [ISS-011] 🟢 `turbo` version pin (`^1.13.3`) may conflict with Node 22+ in future

**Status**: Monitoring
**Affects**: `package.json` devDependencies

### Description

The monorepo uses Turborepo `^1.13.3`. Turborepo v2.x introduced breaking changes in the `turbo.json` pipeline schema (e.g., `pipeline` → `tasks`, new `inputs` syntax). CI uses `npm run build:packages` directly rather than `turbo build`, so Turbo is not currently on the critical CI path. However, any future integration of Turbo into the CI build chain will require a migration to v2+ configuration.

Additionally, the `engines.node` field in `package.json` specifies `>=20` but has not been tested against Node 22 (the current LTS as of 2026). The `next: 14.2.35` dependency targets React 18 and may emit deprecation warnings under Node 22.

### Fix

- Add a CI job that runs `npm install --legacy-peer-deps && npm test` on `node: 22` to catch any compatibility issues early
- Plan a `next.js 15` migration alongside any future Turbo v2 upgrade (both share the same upgrade window)

---

*Last updated: 2026-06-06. To report a new issue, open a GitHub issue with the label `bug` and reference this document.*
