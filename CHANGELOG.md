# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

**`packages/core/src/providers.test.ts` — 12 new Vitest cases**
- First test coverage for `packages/core/src/providers.ts`.
  The `assertMigrationScope` helper and all five provider adapters were previously
  untested at the package level (only tested indirectly via `src/lib/providers.test.ts`).
- Group 1 — `validateForMigration` with scope field (authoritative path, 6 cases):
  throws when scope is `read-only` in `load` phase; throws when scope is `Read-only replica`
  in `rollback` (case-insensitive); does not throw for write scope in `load`; emits
  `console.warn` when write-capable scope is used in `dry-run`; does not throw when
  read-only scope is used in `extract`; no warning for read-only scope in `dry-run`.
- Group 2 — `validateForMigration` with no scope field (ref heuristic fallback, 4 cases):
  throws when ref contains `readonly` in `load` with heuristic note; throws when ref ends
  with `-ro` in `rollback`; warns in `dry-run` with `Set Credential.scope` upgrade hint;
  does not throw for `readonly`-named ref in `extract`.
- Group 3 — `injectCredential` smoke (2 cases): openai adapter attaches `user` +
  `_agentIdentityMeta`; anthropic adapter attaches `metadata.user_id`.

### Changed

**G2 — `assertMigrationScope` hardening (gap from status report)**

- `packages/core/src/types.ts`: added `scope?: string` to `ResolvedCredential`.
  The router now carries the matched `Credential.scope` string through to the resolution
  result, making the actual credential scope available to `validateForMigration()` and
  any downstream code without a separate store lookup.
- `packages/core/src/router.ts`: both `resolve()` and `resolveAsync()` now populate
  `scope: cred.scope` on the returned `ResolvedCredential`.
- `packages/core/src/providers.ts`: `assertMigrationScope()` now has two enforcement paths:
  1. **Scope field (authoritative)** — when `credential.scope` is present, checks it
     case-insensitively: `read-only`, `Read-only replica`, `readonly`, bare `read` →
     read-only; `write`, `read/write`, `readwrite` → write-capable. Skips ref heuristics
     entirely once scope is checked.
  2. **Ref heuristic fallback** — when `credential.scope` is absent, the prior
     `ref.includes('readonly') || ref.endsWith('-ro')` logic still fires, but error
     messages now include `(naming heuristic — set Credential.scope for authoritative
     enforcement)` to nudge callers toward the explicit path.
  This is a **non-breaking change**: `scope` is optional on `ResolvedCredential`;
  existing deployments that do not set `Credential.scope` continue to work via
  the heuristic path.
- `src/lib/types.ts`: added `scope?: string` to dashboard-layer `ResolvedCredential`
  to keep the mirror type aligned with the package type.

---

## [0.5.0] — 2026-05-31

### Added

**Complete Vitest test coverage for all cloud stores and audit infrastructure — 92 new cases**

Test coverage gap closes: all three cloud credential stores (`VaultCredentialStore`,
`AwsCredentialStore`, `AzureKeyVaultCredentialStore`), the SPIFFE workload store
(`SpiffeCredentialStore`), the MCP client adapter (`McpCredentialStore` + `McpToolCaller`),
and the five audit sinks now have full Vitest unit test suites. Every test uses mocked
dependencies — no live cloud endpoints, secrets, or running servers required to run the
full test suite. Total coverage: **297 cases across 16 packages**.

**`VaultCredentialStore` (`packages/stores/vault/src/vault.test.ts`) — 16 cases**
- All HTTP calls mocked via `vi.stubGlobal('fetch', ...)` — no live HashiCorp Vault instance required.
- `findByRef()` (5 cases): returns active credential on 200 KV v2 response; sends `X-Vault-Token`
  header; returns null when status is not active; returns null on non-ok response; returns null
  without throwing on a network-level fetch error.
- `listActive()` (3 cases): returns all active credentials via metadata LIST + individual GETs;
  returns empty array on non-ok metadata response; returns empty array when fetch throws.
- `listByKind()` (2 cases): returns only credentials matching the requested kind; returns empty
  array when no credentials match.
- `reserve()` (3 cases): returns true and writes the lock when no prior lock exists (read → 404);
  returns false when the lock is held by a different migration within TTL; returns true when the
  same migration re-acquires its own active lock.
- `release()` (3 cases): issues a DELETE when the migrationId matches the stored lock; makes only
  the read request when the migrationId does not match (no DELETE); resolves without throwing when
  the lock is already gone.

**`AwsCredentialStore` (`packages/stores/aws/src/aws.test.ts`) — 16 cases**
- Both AWS SDK packages mocked via `vi.mock('@aws-sdk/client-secrets-manager')` and
  `vi.mock('@aws-sdk/client-dynamodb')`. Mocked constructors return objects with `vi.fn()` send
  methods accessed post-construction via `(store as any).sm.send` / `(store as any).dynamo.send`.
  No live AWS endpoint or credentials required.
- `findByRef()` (5 cases): returns active credential on active SecretString; returns null when
  status is not active; returns null when SecretString is absent; returns null without throwing
  when send() throws; sends GetSecretValueCommand with the correct SecretId.
- `listActive()` (4 cases): returns credentials with `agent-identity-status` tag=active parsed
  from Description; skips secrets where the tag value is not active; returns empty array when
  SecretList is undefined; skips secrets with malformed Description JSON.
- `listByKind()` (2 cases): returns only credentials matching the requested kind; returns empty
  array when no credentials match.
- `reserve()` (3 cases): returns true when DynamoDB PutItem succeeds (no conflicting lock);
  returns false when DynamoDB throws ConditionalCheckFailedException; sends PutItemCommand to the
  configured locksTable name.
- `release()` (2 cases): issues a DeleteItemCommand with the correct ref key; resolves without
  throwing when DeleteItem throws (idempotent).

**`AzureKeyVaultCredentialStore` (`packages/stores/azure/src/azure.test.ts`) — 17 cases**
- All Azure SDK packages mocked via `vi.mock('@azure/identity')`, `vi.mock('@azure/keyvault-secrets')`,
  `vi.mock('@azure/data-tables')`. Mock clients accessed post-construction via
  `(store as any).secrets` and `(store as any).table`. No Azure authentication or network calls
  required.
- `constructor` (2 cases): throws `'keyVaultUrl is required'` when neither the option nor
  `AZURE_KEYVAULT_URL` env var is set; throws `'tablesEndpoint is required'` when neither the
  option nor `AZURE_TABLES_ENDPOINT` env var is set.
- `findByRef()` (4 cases): returns active credential when `contentType=active` and value parses;
  returns null when `contentType` is not active; returns null when secret value is undefined;
  returns null without throwing when `getSecret()` throws.
- `listActive()` (4 cases): returns credentials iterated from the async `listPropertiesOfSecrets`
  generator; skips secrets with `contentType !== active` without calling `getSecret()`; skips
  secrets with `enabled=false`; returns empty array when `listPropertiesOfSecrets` throws.
- `listByKind()` (1 case): returns only credentials matching the requested kind.
- `reserve()` (3 cases): returns true when `getEntity` throws `EntityNotFound` and `upsertEntity`
  succeeds; returns false when a different migration holds an unexpired lock; returns true when the
  same migration re-acquires its own lock.
- `release()` (3 cases): calls `deleteEntity` when migrationId matches; does not call
  `deleteEntity` when migrationId does not match; resolves without throwing when `getEntity` throws
  (lock already released — idempotent).

**`SpiffeCredentialStore` (`packages/stores/spiffe/src/spiffe.test.ts`) — 12 cases**
- A mock `WorkloadApiClient` is injected directly via `(store as any).client`, bypassing the
  dynamic import in `getClient()` entirely. No `@spiffe/spiffe-workload-api` runtime dependency
  required. `reserve()` / `release()` use the private in-memory reservations Map — no external calls.
- `findByRef()` — SVID resolution (5 cases): returns credential with SVID PEM as ref when SVID hint
  matches; returns credential when matched by SPIFFE ID path segment; returns credential when matched
  by full SPIFFE ID string; returns null when ref is not in the configured credentials list; returns
  null (no throw) when the workload API rejects.
- SVID caching (2 cases): `fetchX509Svids` called once despite two `findByRef()` calls on the same
  ref (cache hit); re-fetches after `flushCache()` — `fetchX509Svids` called twice.
- `listActive()` and `listByKind()` (2 cases): `listActive()` returns only credentials with
  `status=active` from options; `listByKind()` filters correctly between `fixed` and `user-delegated`.
- `reserve()` and `release()` (2 cases): `reserve()` returns false when a different migration holds
  the lock within TTL; `release()` clears the lock so a new migration can acquire it.
- `close()` (1 case): calls `close()` on the injected `WorkloadApiClient`.

**`McpCredentialStore` + `McpToolCaller` (`packages/integrations/mcp-client/src/mcp-client.test.ts`) — 16 cases**
- Both classes use a lazy-connect pattern (`ensureConnected()` checks `this.client` first). A mock
  MCP `Client` object is injected directly via `(store/caller as any).client` after construction,
  so `_connect()` and the `@modelcontextprotocol/sdk` transports are never invoked. No running MCP
  server is required.
- `McpCredentialStore` (9 cases):
  - `listActive()` (5 cases): returns only active credentials from the server's `list_credentials`
    response; caches results — `callTool` invoked once despite two `listActive()` calls;
    `invalidateCache()` forces a fresh server fetch (callTool called twice); throws `'non-JSON
    response'` when the server returns unparseable text; throws `'missing credentials array'` when
    the response lacks the `credentials` field.
  - `findByRef()` (2 cases): returns the matching active credential by ref; returns null when the
    ref is absent from the server list.
  - `listByKind()` (1 case): returns only credentials matching the requested kind.
  - `disconnect()` (1 case): calls `close()` on the injected client and sets `this.client` to null.
- `McpToolCaller` (7 cases): `resolveCredential()` calls `resolve_credential` with forwarded args
  and returns the parsed result; `resolveMigrationCredential()` calls `resolve_migration_credential`
  and returns pair; `health()` calls `health` tool and returns status; `callTool()` generic escape
  hatch returns parsed result for any tool; throws `'non-JSON'` on unparseable response; throws the
  tool error message when result contains an `error` field; `disconnect()` calls `close()` on the
  injected client.

**Audit sinks (`packages/audit/src/audit.test.ts`) — 15 cases**
- All `fetch` calls mocked via `vi.stubGlobal('fetch', ...)`. `console.log`/`console.warn` spied and
  silenced where needed.
- `ConsoleAuditLogger` (2 cases): calls `console.log` with `[agent-identity audit]` prefix and the
  JSON-serialised entry; resolves without throwing on a valid `AuditLogEntry`.
- `WebhookAuditLogger` (4 cases): POSTs the entry as JSON to the configured URL; adds the
  `X-Webhook-Secret` header when a secret is configured; resolves without throwing when fetch fails
  and `silent=true` (default); throws when fetch fails and `silent=false`.
- `DatadogAuditLogger` (3 cases): POSTs to the Datadog log intake URL with the `DD-API-KEY` header;
  uses a custom Datadog site (`datadoghq.eu`) when the `site` option is set; is silent by default
  when fetch fails.
- `SplunkAuditLogger` (3 cases): POSTs to the HEC URL with a `Splunk <token>` `Authorization`
  header; includes the full audit entry inside the Splunk event payload; is silent by default when
  fetch fails.
- `CompositeAuditLogger` (3 cases): forwards the entry to all registered loggers; continues via
  `Promise.allSettled` even when one logger rejects (logB still receives the entry); works correctly
  with a single logger.

---

## [0.4.0] — 2026-05-30

### Added

**Fastify plugin test coverage (`packages/integrations/fastify/src/fastify.test.ts`) — 12 cases**
- Previously the only framework integration package (alongside NestJS) with zero Vitest test coverage.
- No fastify runtime dependency required — Fastify uses `import type` for
  `FastifyPluginAsync`, `FastifyRequest`, `FastifyReply`; type imports are erased
  at runtime. A minimal mock Fastify instance captures `decorateRequest` and
  `addHook` calls; the preHandler hook is extracted directly and invoked in tests.
- `plugin registration` (1 case): `agentIdentityPlugin` is a valid fastify-plugin —
  `Symbol.for('skip-override')` is set to `true` by `fp()`, confirming the
  encapsulation bypass is in place.
- `passThrough behavior` (4 cases): absent agentContext + passThrough=true sends no
  reply; undefined req.body + passThrough=true sends no reply; passThrough=false
  sends 400; 400 error message names the missing contextKey field.
- `credential resolution` (5 cases): resolvedCredential attached to request on
  successful resolution; resolvedFor='service' for fixed creds; resolvedFor=ctx.userId
  for user-delegated creds; 403 when no rule matches; 403 when matched credential
  is expired.
- `custom contextKey` (2 cases): reads agent context from correct body field;
  400 error message names the custom contextKey when passThrough=false.

**NestJS integration test coverage (`packages/integrations/nestjs/src/nestjs.test.ts`) — 12 cases**
- Previously the only NestJS integration package with zero Vitest test coverage.
- NestJS decorators (`@Injectable`, `@Inject`, `CanActivate`, `ExecutionContext`,
  `ForbiddenException`, `createParamDecorator`) are mocked via `vi.mock()` factory
  hoisted before module import — no `@nestjs/common` runtime dependency required.
  `AgentIdentityService` and `AgentIdentityGuard` are instantiated directly,
  bypassing the NestJS DI container entirely.
- `AgentIdentityService.resolve()` (4 cases): returns ResolvedCredential with correct
  credentialId; resolvedFor='service' for fixed creds; resolvedFor=ctx.userId for
  user-delegated creds; returns null when no rule matches.
- `AgentIdentityService.resolveAsync()` (2 cases): returns the same result as
  resolve() via the async path; returns null on no match.
- `AgentIdentityService.resolvePairAsync()` (2 cases): returns ResolvedCredentialPair
  with source, target, and migrationId when both rules match; returns null when no
  rule matches the migration context.
- `AgentIdentityGuard.canActivate()` (3 cases): returns true and does not attach
  credential when no agentContext is present (non-agent route pass-through); returns
  true and attaches resolvedCredential to request under `RESOLVED_CREDENTIAL_KEY`
  on success; throws ForbiddenException when resolveAsync() returns null.
- `AgentIdentityGuard.extractContext()` (2 cases): returns the agentContext object
  from request.body; returns null when request.body is absent.

### Fixed

**`@datacules/agent-identity-otel` — `resolvePairAsync()` correctness gap**
- `TracedRouter` interface was missing `resolvePairAsync()`, which was added
  to `CredentialRouter` in the v0.3.0 hardening pass (PR #19). Any consumer
  who called `resolvePairAsync()` on a `withOtel()`-wrapped router received a
  runtime "not a function" error. The method is now added to both the interface
  and the `withOtel()` return object, so all four resolution paths are covered.
- Extracted `annotateMigrationCtx()` private helper to avoid repeating the
  three migration attribute `setAttribute` calls in `resolvePair` and
  `resolvePairAsync`.

**OTEL test coverage (`packages/integrations/otel/src/otel.test.ts`) — 13 cases**
- Previously the only feature package with zero Vitest test coverage.
- Mock tracer and span are plain `vi.fn()` objects — no `@opentelemetry/api`
  runtime dependency is required (the source only uses `import type`).
- `withOtel — resolve()` (5 cases): span name, standard attributes,
  `routing.resolved=true` with credential attributes, `routing.resolved=false`
  on null, span ends even when router throws.
- `withOtel — resolveAsync()` (3 cases): span name, awaited result propagated,
  exception recorded + span ended on rejection.
- `withOtel — resolvePair()` (3 cases): span name + migration attrs, pair
  returned with `routing.resolved=true`, span ends on throw.
- `withOtel — resolvePairAsync()` (2 cases): span name, `routing.resolved=false`
  on null; rejection records exception and ends span.

**LangChain test coverage (`packages/integrations/langchain/src/langchain.test.ts`) — 12 cases**
- The test file described in PR #2 (`__tests__/langchain.test.ts`) was never
  committed to the final merged branch. This PR adds full coverage.
- `@langchain/core/callbacks/base` is mocked via `vi.mock()` factory — works
  whether or not `@langchain/core` is installed in root node_modules.
- `createAgentIdentityModel` (5 cases): resolved metadata returned, correct
  `credentialId` / `resolvedFor`, `getModel` is a function, throws on no rule
  match, `fetchSecret` called with resolved ref before unsupported-provider throw.
- `AgentIdentityCallbackHandler` (3 cases): instantiates, `handleLLMStart`
  attaches `agentIdentityCredentialId` and `agentIdentityResolvedFor` to
  `extraParams`, `handleLLMEnd` resolves without throwing.
- `createAgentIdentityNode` (4 cases): `resolvedCredential` injected into state,
  all existing state properties preserved, throws on missing `agentContext`,
  throws on no-match credential.

**Express middleware test coverage (`packages/integrations/express/src/express.test.ts`) — 13 cases**
- No express runtime dependency required — `express` is only used via `import type`
  in the source, so type imports are erased and req/res/next are plain `vi.fn()` mocks.
- `passThrough behavior` (4 cases): absent agentContext + passThrough=true calls next;
  undefined req.body + passThrough=true calls next; passThrough=false sends 400;
  400 error message names the missing contextKey field.
- `credential resolution` (7 cases): resolvedCredential attached to req on match;
  next() called and no response sent on match; resolvedFor='service' for fixed creds;
  resolvedFor=ctx.userId for user-delegated creds; 403 when no rule matches;
  403 when matched credential is expired; audit logger invoked synchronously on success.
- `custom contextKey` (2 cases): reads context from correct body field;
  400 error message names the custom contextKey when passThrough=false.

**MCP tools test coverage (`packages/integrations/mcp/src/mcp.test.ts`) — 14 cases**
- `tools.ts` imports only `zod` and `@datacules/agent-identity` — no
  `@modelcontextprotocol/sdk` runtime dependency needed. Tool handlers are called
  directly with a `ToolDeps` object.
- `resolve_credential` (4 cases), `resolve_migration_credential` (3 cases),
  `list_credentials` (3 cases), `list_rules` (2 cases), `health` (2 cases).

---

## [0.3.0] — 2026-05-29

### Added

**Dashboard — `AnomalyTab` (tab #11)**
- `src/components/AnomalyTab.tsx` — full interactive anomaly detection dashboard
- `src/app/api/anomaly/route.ts` — `POST /api/anomaly` + `DELETE /api/anomaly?userId=`
- `src/lib/anomaly.ts` — re-export shim
- `src/app/page.tsx` — `AnomalyTab` added as tab #11

**OpenAPI spec v0.3.0** — all 9 endpoints added since v0.1.0 now documented.

**Test coverage — Phase 1–4 modules (PR #17)** — 86 new cases across 6 files.

**Test coverage — anomaly package (PR #20)** — 16 cases.

**Test coverage — DynamicCredentialStore + provisioners (PR #21)** — 13 cases.

**CI / testing infrastructure (PR #22)** — vitest.config.ts include pattern expanded to `packages/**`.

### Fixed

- `approval.ts`: `SlackApprovalNotifier` — renamed `_policy` parameter to `policy`
- `types.ts`: `AuditLogger.log()` signature broadened to `void | Promise<void>`
- `approval.ts`: `ApprovalPolicy` type reconciliation
- `router.ts`: Added `resolvePairAsync()`
- `packages/integrations/anomaly/src/index.ts`: `emitAnomaly()` wrapped in `Promise.resolve()`
- `tsconfig.json`: added `@datacules/agent-identity-anomaly` path alias

---

## [0.2.0] — 2026-05-28

Major release. Transforms `agent-identity` into a full Turborepo monorepo with 17 packages.
See previous CHANGELOG entries for full details.

---

## [0.1.0] — 2026-05-24

### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- `CredentialRouter` with multi-field routing
- Provider adapters for OpenAI, Anthropic, Gemini, Mistral, local
- Server-side credential resolution API routes
- Migration support: `resolvePair()`, phase-aware routing, `reserve()` / `release()`
- Decision helper, CI pipeline, Datacules open source license
