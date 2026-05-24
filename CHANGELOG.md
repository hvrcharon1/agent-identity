# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- Server-side credential resolution API route (`src/app/api/resolve/route.ts`) — credentials never exposed to client bundle
- `src/lib/server/credentialStore.ts` — server-side credential store stub with production swap-in points
- Multi-field routing: `RoutingRule` now supports `matchAction`, `matchProvider`, `matchUserId`, and `priority` scoring
- `CredentialStore` and `AuditLogger` interfaces — dependency injection on `CredentialRouter`
- `MemoryCredentialStore` — default in-memory implementation for local dev
- `expiresAt`, `lastRotated`, `refreshTokenRef`, `rotationIntervalDays` fields on `Credential`
- Expiry check in `router.resolve()` — expired credentials return null
- `traceId`, `sessionId`, `requestedAt`, `parentTraceId` fields on `AgentRequestContext`
- `AuditLogEntry` typed interface (replaces `Record<string, unknown>`)
- `src/components/icons.tsx` — single shared icon source (eliminates 60+ lines of duplication)
- Vitest unit tests: `router.test.ts`, `decision.test.ts`, `providers.test.ts`
- `vitest.config.ts` with `@` path alias
- `test` and `test:watch` npm scripts
- Unit test job in CI pipeline (runs before build-and-smoke)
- `longTermTokenStorage` Q4 in `DecisionAnswers` — surfaces `token-exchange` pattern
- Missing `computeDecision` case: `!variableAccess && mixedResources` now returns fixed-credential with resource-type awareness
- Provider-specific injection notes in `PatternsTab` (wired to `activeProvider`)
- Provider filter notice in `CredentialsTab`
- Expiry warning badges in `CredentialsTab`
- `activeProvider` prop wired through from `page.tsx` to `PatternsTab` and `CredentialsTab`
- `validate()` optional method on `ProviderAdapter` interface
- Correct Gemini injection point (`labels.user_id`, `x-goog-api-key` header note)
- Correct Mistral and local adapter injection notes with TODO comments
- `.env.example` with all required environment variables
- `CONTRIBUTING.md` — local setup, adapter guide, routing rule guide, coding conventions
- `CHANGELOG.md`
- GitHub issue templates: `bug.yml` and `feature.yml`

### Removed
- Ghost dependencies: `@radix-ui/react-tabs`, `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-tooltip`, `zustand`, `jose`, `lucide-react`

### Fixed
- `useCredentials` hook no longer re-instantiates `CredentialRouter` on every `resolve()` call (memoized via `useMemo`)
- `router.resolve()` previously matched only on `resourceKind` — now scores by priority across all match fields

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter` with `resourceKind`-based routing
- Provider adapters for OpenAI, Anthropic, Gemini, Mistral, local
- CI pipeline: type-check, lint, build, smoke test
- Datacules open-source license
- Logo and branding assets

---

<!-- ci: triggered May 25 2026 — verify all 14 enhancement findings -->
