# Agent Identity — Enhancement Report

> **Repository:** [hvrcharon1/agent-identity](https://github.com/hvrcharon1/agent-identity)
> **Reviewed by:** Datacules LLC engineering review
> **Date:** May 2026
> **Scope:** Full read of every source file — `src/lib/*`, `src/components/*`, `src/hooks/*`, `src/app/*`, `package.json`, `.github/workflows/ci.yml`, all docs and examples

---

## Summary

| Priority | Count | Description |
|---|---|---|
| 🔴 Critical | 3 | Security gaps or logic failures that would break production |
| 🟠 High | 4 | Actively misleads users or blocks real-world use |
| 🔵 Medium | 4 | Logic gaps, performance issues, DRY violations |
| 🟢 Low | 3 | Polish, open-source hygiene, developer experience |
| **Total** | **14** | — |

---

## 🔴 Critical

### 1. Credential resolution must move to the server — it currently runs client-side

**Files:** `src/lib/router.ts` · `src/hooks/useCredentials.ts`

**Problem**

The entire `CredentialRouter` class and the `useCredentials` hook execute in the browser because `useCredentials` is imported by `'use client'` components. This means credential references — and in `providers.ts`, the `_credentialRef` strings — are shipped to the client bundle and visible in React DevTools, network responses, and browser memory. In a real deployment, resolving refs → actual secrets must happen in a Next.js API Route or Server Action — never in a client hook.

Currently:

```
Browser → useCredentials() → CredentialRouter.resolve() → _credentialRef exposed
```

Required:

```
Browser → POST /api/resolve → Server resolves ref → encrypted store → AI provider
```

**Fix**

Create `src/app/api/resolve/route.ts` as a POST endpoint. The client sends an `AgentRequestContext`; the server resolves the credential from an encrypted store and injects it into the outbound AI call — returning only the sanitised AI response to the client. The client never sees the ref or the secret.

```typescript
// src/app/api/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createRouter } from '@/lib/router';
import { getServerCredentials, getServerRules } from '@/lib/server/credentialStore';
import type { AgentRequestContext } from '@/lib/types';

export async function POST(req: NextRequest) {
  const ctx: AgentRequestContext = await req.json();
  const credentials = await getServerCredentials();
  const rules = await getServerRules();
  const router = createRouter(credentials, rules);
  const resolved = router.resolve(ctx);
  if (!resolved) {
    return NextResponse.json({ error: 'No credential resolved' }, { status: 403 });
  }
  // Inject credential server-side and call AI provider here
  // Never return resolved.ref or any secret to the client
  return NextResponse.json({ ok: true });
}
```

**Labels:** `security` `architecture`

---

### 2. Router only matches on `resourceKind` — ignores action, provider, and userId

**Files:** `src/lib/router.ts` · `src/lib/types.ts`

**Problem**

The `resolve()` method does:

```typescript
const rule = this.rules.find((r) => r.resourceKind === ctx.resourceKind);
```

This is first-match only on a single field. Two rules with the same `resourceKind` — the second is silently ignored forever. There is no way to route by:

- `action` — e.g. `read` vs `write` should use different credentials
- `provider` — OpenAI calls may need a different credential than Anthropic
- `userId` pattern — certain users may have elevated credential tiers
- `priority` — more specific rules should win over general ones

This makes the Hybrid and Context-switched patterns — which are the main differentiators of this product — barely functional in real scenarios.

**Fix**

Extend `RoutingRule` to support optional match criteria with a priority score:

```typescript
// src/lib/types.ts
export interface RoutingRule {
  id: string;
  description: string;
  credentialRef: string;
  credentialKind: CredentialKind;
  priority: number;                       // higher number wins
  matchResourceKind?: ResourceKind;       // optional — omit to match any
  matchAction?: string | string[];        // e.g. 'write' or ['write', 'delete']
  matchProvider?: SupportedProvider;      // e.g. 'openai'
  matchUserId?: string;                   // exact match or regex string
}
```

Update `resolve()` to score by specificity:

```typescript
resolve(ctx: AgentRequestContext): ResolvedCredential | null {
  const matching = this.rules
    .filter((r) => this.ruleMatches(r, ctx))
    .sort((a, b) => b.priority - a.priority); // highest priority first

  const rule = matching[0];
  if (!rule) return null;
  // ... rest of resolution
}

private ruleMatches(rule: RoutingRule, ctx: AgentRequestContext): boolean {
  if (rule.matchResourceKind && rule.matchResourceKind !== ctx.resourceKind) return false;
  if (rule.matchProvider && rule.matchProvider !== ctx.provider) return false;
  if (rule.matchUserId && rule.matchUserId !== ctx.userId) return false;
  if (rule.matchAction) {
    const actions = Array.isArray(rule.matchAction) ? rule.matchAction : [rule.matchAction];
    if (!actions.includes(ctx.action)) return false;
  }
  return true;
}
```

**Labels:** `core-logic` `routing`

---

### 3. No unit tests — router, decision engine, and adapters have zero coverage

**Files:** `package.json` · `src/lib/*`

**Problem**

The CI pipeline runs type-check, lint, build, and an HTTP smoke test — but there are zero test files anywhere in the repository. The three most security-critical modules have no coverage:

- `router.ts` — a routing regression could deliver the wrong credential to the wrong user silently
- `decision.ts` — an unhandled boolean case already returns `null` with no warning (see Finding 8)
- `providers.ts` — no adapter is verified to produce correct output for its target provider

A credential routing bug that ships without test coverage is a security incident waiting to happen.

**Fix**

Add Vitest — it works natively with Next.js 14 without a separate Babel config:

```bash
npm install -D vitest @vitejs/plugin-react
```

Minimum required test cases:

```typescript
// src/lib/router.test.ts
import { describe, it, expect } from 'vitest';
import { createRouter } from './router';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from './credentials';

describe('CredentialRouter', () => {
  const router = createRouter(DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES);

  it('resolves user-delegated credential for a personal resource', () => {
    const result = router.resolve({
      userId: 'user-1', resourceId: 'kb-1', resourceKind: 'personal',
      provider: 'anthropic', model: 'claude-sonnet-4-20250514', action: 'read',
    });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('user-delegated');
    expect(result?.resolvedFor).toBe('user-1');
  });

  it('resolves fixed credential for a shared resource', () => {
    const result = router.resolve({
      userId: 'user-1', resourceId: 'linear-1', resourceKind: 'shared',
      provider: 'openai', model: 'gpt-4o', action: 'write',
    });
    expect(result?.kind).toBe('fixed');
    expect(result?.resolvedFor).toBe('service');
  });

  it('returns null when no rule matches', () => {
    const emptyRouter = createRouter([], []);
    const result = emptyRouter.resolve({
      userId: 'u', resourceId: 'r', resourceKind: 'personal',
      provider: 'openai', model: 'gpt-4o', action: 'read',
    });
    expect(result).toBeNull();
  });
});
```

Also add tests for all 8 boolean permutations in `decision.ts` and per-adapter field assertions in `providers.ts`.

Add to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Add to `.github/workflows/ci.yml` after lint:

```yaml
test:
  name: Unit tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm install
    - run: npm test
```

**Labels:** `testing` `CI` `security`

---

## 🟠 High

### 4. Ghost dependencies — 7 packages declared but never imported

**File:** `package.json`

**Problem**

After reading every source file, these packages are declared in `dependencies` but not imported anywhere:

| Package | Declared for | Reality |
|---|---|---|
| `@radix-ui/react-tabs` | Accessible tabs | Not used — raw `<button>` tabs in `page.tsx` |
| `@radix-ui/react-dialog` | Modal dialogs | No dialogs in any component |
| `@radix-ui/react-select` | Dropdowns | No selects in any component |
| `@radix-ui/react-switch` | Toggle switches | No switches in any component |
| `@radix-ui/react-tooltip` | Tooltips | No tooltips in any component |
| `zustand` | State management | No store file exists |
| `jose` | JWT validation | No JWT logic anywhere |

Additionally, `lucide-react` is declared but the components switched to inline SVGs — making it unused dead weight.

This bloats the production bundle, signals unimplemented features to contributors, and creates confusion about what the intended architecture is.

**Fix**

Option A — remove them now, re-add as features are built:

```bash
npm uninstall @radix-ui/react-tabs @radix-ui/react-dialog @radix-ui/react-select \
  @radix-ui/react-switch @radix-ui/react-tooltip zustand jose lucide-react
```

Option B — implement what they were planned for (recommended):

- `zustand` → global credential store, replacing `DEFAULT_CREDENTIALS` with reactive state
- `jose` → JWT validation on incoming user auth tokens in the API route
- Radix primitives → accessible dropdown in CredentialsTab, dialog for adding credentials
- `lucide-react` → replace duplicated inline SVGs across components (see Finding 7)

**Labels:** `dependencies` `bundle-size`

---

### 5. No `CredentialStore` interface — hardcoded arrays make DB swap impossible

**Files:** `src/lib/credentials.ts` · `src/lib/types.ts`

**Problem**

`DEFAULT_CREDENTIALS` is a plain exported array:

```typescript
export const DEFAULT_CREDENTIALS: Credential[] = [ ... ];
```

There is no abstraction layer between the router and the data source. To swap in HashiCorp Vault, AWS Secrets Manager, or an encrypted Postgres table, you would need to edit `router.ts` and `useCredentials.ts` directly — tight coupling that violates the open/closed principle.

Additionally, `auditEntry()` in `router.ts` returns `Record<string, unknown>` — there is no `AuditLogEntry` type and no `AuditLogger` interface. The audit trail is untyped and has no real write target.

**Fix**

Define a `CredentialStore` interface and an `AuditLogger` interface. The router takes them as constructor dependencies (dependency injection):

```typescript
// src/lib/types.ts — add these interfaces

export interface CredentialStore {
  findByRef(ref: string): Promise<Credential | null>;
  listActive(): Promise<Credential[]>;
  listByKind(kind: CredentialKind): Promise<Credential[]>;
}

export interface AuditLogEntry {
  timestamp: string;
  traceId: string;
  userId: string;
  action: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  credentialId: string;
  credentialKind: CredentialKind;
  resolvedFor: string;
}

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}
```

```typescript
// src/lib/router.ts — inject dependencies
export class CredentialRouter {
  constructor(
    private store: CredentialStore,
    private rules: RoutingRule[],
    private logger?: AuditLogger,
  ) {}
}
```

A default in-memory `CredentialStore` can wrap `DEFAULT_CREDENTIALS` for local dev. A production implementation connects to Vault or an encrypted DB without touching the router.

**Labels:** `architecture` `extensibility` `security`

---

### 6. `activeProvider` state set in `page.tsx` but never consumed by any tab

**Files:** `src/app/page.tsx` · all tab components

**Problem**

The provider strip (Any provider / OpenAI / Anthropic / Gemini / Mistral / Local) allows users to select a provider, and the selected state is tracked in `useState`:

```typescript
const [activeProvider, setActiveProvider] = useState<SupportedProvider | 'any'>('any');
```

But `activeProvider` is never passed as a prop to `IdentitiesTab`, `PatternsTab`, `CredentialsTab`, or `DecisionTab`. The selection is visually active but functionally dead. Users who select "Anthropic" expecting to see Anthropic-specific auth instructions will see identical content to "OpenAI". This is a broken affordance — the UI promises something it doesn't deliver.

**Fix**

Pass `activeProvider` to each tab as a prop and use it:

```typescript
// page.tsx
{activeTab === 'patterns' && <PatternsTab provider={activeProvider} />}
{activeTab === 'credentials' && <CredentialsTab provider={activeProvider} />}
```

In `PatternsTab` — show provider-specific credential injection notes:

```typescript
// PatternsTab.tsx
const PROVIDER_NOTES: Partial<Record<SupportedProvider, string>> = {
  openai:    'Inject via Authorization: Bearer header + user field in request body.',
  anthropic: 'Inject via x-api-key header + metadata.user_id for audit.',
  gemini:    'Inject via Authorization: Bearer header in generationConfig request.',
};
```

In `CredentialsTab` — filter displayed credentials by provider when one is selected.

**Labels:** `UX` `dead-state`

---

### 7. `Credential` type missing expiry, refresh, and rotation fields

**File:** `src/lib/types.ts`

**Problem**

The `Credential` interface has:

```typescript
status: 'active' | 'pending' | 'revoked';
```

There is no `expiresAt`, `lastRotated`, or `refreshToken` field. OAuth 2.0 access tokens typically expire in 1 hour. Service account keys should be rotated on a schedule. Without these fields:

- The router cannot detect or skip expired credentials
- A credential marked `active` may have expired hours ago
- There is no mechanism to trigger token refresh before expiry
- The UI cannot warn operators that credentials are near expiry

**Fix**

```typescript
// src/lib/types.ts
export interface Credential {
  id: string;
  kind: CredentialKind;
  name: string;
  scope: string;
  status: CredentialStatus;
  provider?: string;
  ref: string;
  // — new fields —
  expiresAt?: string;            // ISO 8601 — undefined means does not expire
  lastRotated?: string;          // ISO 8601 — for audit and rotation scheduling
  refreshTokenRef?: string;      // encrypted ref to refresh token in store
  rotationIntervalDays?: number; // policy: rotate every N days
}
```

The router's `resolve()` should reject credentials where `expiresAt` is in the past:

```typescript
const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();
if (!cred || cred.status !== 'active' || isExpired) return null;
```

**Labels:** `security` `types`

---

## 🔵 Medium

### 8. Duplicate inline SVG icon definitions across `IdentitiesTab` and `PatternsTab`

**Files:** `src/components/IdentitiesTab.tsx` · `src/components/PatternsTab.tsx`

**Problem**

`IconUserCheck`, `IconLock`, and `IconArrows` are defined with identical SVG path code in both files — over 60 lines of duplication. Any icon path change requires two edits. Additionally, `lucide-react` is listed in `package.json` but the codebase switched to inline SVGs — leaving the package as unused dead weight (also noted in Finding 4).

**Fix**

Create a single shared icons file:

```typescript
// src/components/icons.tsx
export function IconUserCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <polyline points="16 11 18 13 22 9"/>
    </svg>
  );
}

// Export all shared icons from one place:
// IconLock, IconArrows, IconBot, IconKey, IconInfo, IconDatabase, IconMail, IconClock, IconCheck
```

Import from the single source in both tabs:

```typescript
import { IconUserCheck, IconLock, IconArrows } from '@/components/icons';
```

**Labels:** `DRY` `maintainability`

---

### 9. Decision helper never recommends token-exchange — and has an unhandled boolean case

**File:** `src/lib/decision.ts`

**Problem**

The `computeDecision` function explicitly handles 4 of the 8 possible boolean permutations of its three inputs. The combination `variableAccess=false, mixedResources=true` — which is a valid real-world configuration — returns `null` silently. No UI feedback is shown to the user.

Additionally, `token-exchange` is defined as a complete auth pattern in `patterns.ts` with its own flow diagram, but it is unreachable from the decision helper. The pattern is orphaned from the primary navigation surface.

**Full truth table of current state:**

| variableAccess | mixedResources | auditRequired | Current result |
|---|---|---|---|
| true | true | any | context-switched ✓ |
| true | false | any | individual-user-auth ✓ |
| false | false | false | fixed-credential ✓ |
| false | false | true | fixed-credential + tagging ✓ |
| false | true | any | **null — unhandled** ✗ |
| any | any | any | **token-exchange never recommended** ✗ |

**Fix**

Add a fourth question to surface `token-exchange`, and handle the missing case:

```typescript
// Add to DecisionAnswers in types.ts
longTermTokenStorage: boolean | null; // Q4: can you store per-user tokens long-term?

// In decision.ts — new case
if (!longTermTokenStorage && variableAccess) {
  return {
    pattern: 'token-exchange',
    label: 'Token exchange / impersonation',
    explanation: 'You need per-user access but cannot store tokens long-term. Use OAuth token exchange or STS assume-role to get scoped user tokens at request time.',
  };
}

// Handle the missing case
if (!variableAccess && mixedResources) {
  return {
    pattern: 'fixed-credential',
    label: 'Fixed credential with resource-type awareness',
    explanation: 'All users are equal but the agent accesses different resource types. A single fixed credential works — ensure its scope covers both resource types your agent needs.',
  };
}
```

**Labels:** `logic-gap` `UX`

---

### 10. `useCredentials` hook re-instantiates the router on every resolve call

**File:** `src/hooks/useCredentials.ts`

**Problem**

Inside the `resolve` callback:

```typescript
const resolve = useCallback(
  (ctx: AgentRequestContext): ResolvedCredential | null => {
    const router = createRouter(credentials, rules); // ← new instance every call
    return router.resolve(ctx);
  },
  [credentials, rules]
);
```

A new `CredentialRouter` class instance is created on every single call to `resolve()`. This is wasteful in the synchronous case and would be a significant problem once credentials are fetched asynchronously — each resolve call would trigger a new async fetch.

**Fix**

Memoize the router instance:

```typescript
import { useMemo, useCallback } from 'react';

export function useCredentials() {
  const [credentials] = useState(DEFAULT_CREDENTIALS);
  const [rules] = useState(DEFAULT_ROUTING_RULES);

  const router = useMemo(
    () => createRouter(credentials, rules),
    [credentials, rules]
  );

  const resolve = useCallback(
    (ctx: AgentRequestContext) => router.resolve(ctx),
    [router]
  );

  return { credentials, rules, resolve };
}
```

The router is now created once per credential/rule state change, not once per call.

**Labels:** `performance` `hooks`

---

### 11. No `traceId` or `sessionId` in `AgentRequestContext` — cross-request correlation is impossible

**File:** `src/lib/types.ts`

**Problem**

The context type has `userId`, `resourceId`, `action` — but no `traceId`, `sessionId`, or `requestedAt` field. The audit log entries produced by `auditEntry()` therefore cannot:

- Correlate multi-step agent workflows (steps 1–5 of the same agent session are unlinked)
- Feed into distributed tracing (OpenTelemetry, Datadog APM)
- Answer the question: "which credential was used across all steps of session X"
- Support time-range queries on audit logs (no timestamp in the context itself)

For a product built around identity and auditability, this is a significant gap.

**Fix**

```typescript
// src/lib/types.ts
export interface AgentRequestContext {
  userId: string;
  resourceId: string;
  resourceKind: ResourceKind;
  provider: SupportedProvider;
  model: string;
  action: string;
  // — new tracing fields —
  traceId: string;         // propagate across all steps of a multi-step agent run
  sessionId?: string;      // groups related requests for the same user session
  requestedAt: string;     // ISO 8601 — when the request was initiated
  parentTraceId?: string;  // for nested agent calls (agent calling another agent)
}
```

**Labels:** `observability` `audit`

---

## 🟢 Low

### 12. Gemini, Mistral, and local adapters are hollow — credential injection is a no-op

**File:** `src/lib/providers.ts`

**Problem**

The Gemini adapter puts credential data in a `_meta` object that is not part of the Gemini API spec and would be ignored or cause a validation error with the real SDK. The Mistral and local adapters are identical to each other. In contrast, the OpenAI adapter correctly uses the `user` field (a real OpenAI field for abuse prevention) and the Anthropic adapter correctly uses `metadata.user_id`.

**Fix**

Document the real injection point for each provider with explicit `TODO` comments:

```typescript
const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request, credential) {
    // TODO: Real Gemini auth — API key goes in `x-goog-api-key` header (server-side only).
    // The generationConfig body field does NOT carry auth.
    // For user tracking: add request.labels = { user_id: credential.resolvedFor }
    return {
      ...request,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'x-goog-api-key header (server-side)',
      },
    };
  },
};
```

Also add an optional `validate?(request: Record<string, unknown>): void` method to the `ProviderAdapter` interface — implementors can throw early if required fields are missing before the request hits the real API.

**Labels:** `adapters` `correctness`

---

### 13. No `.env.example` — no contract for what environment variables are needed

**Files:** project root · `.gitignore`

**Problem**

There is no `.env.example` file and no `process.env` usage anywhere in the codebase. The `.gitignore` correctly excludes `.env*.local`, but there is no template showing what variables are expected. Contributors trying to run this against a real credential store have no starting point and will either skip environment config or hard-code secrets.

**Fix**

Create `.env.example` at the project root:

```bash
# .env.example — copy to .env.local and fill in values
# Do NOT commit .env.local — it is gitignored

# ─── Credential Store ──────────────────────────────────────────────────────
CREDENTIAL_ENCRYPTION_KEY=        # AES-256 key for encrypting credential refs at rest
CREDENTIAL_STORE_URL=             # Connection string (Postgres, Redis, Vault)

# ─── Audit Logging ─────────────────────────────────────────────────────────
AUDIT_LOG_ENDPOINT=               # POST endpoint for AuditLogEntry JSON payloads

# ─── AI Provider Base URLs ─────────────────────────────────────────────────
OPENAI_API_BASE=https://api.openai.com/v1
ANTHROPIC_API_BASE=https://api.anthropic.com
GEMINI_API_BASE=https://generativelanguage.googleapis.com
MISTRAL_API_BASE=https://api.mistral.ai

# ─── App ───────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Labels:** `devex` `config`

---

### 14. Missing `CONTRIBUTING.md`, `CHANGELOG.md`, and GitHub issue templates

**Files:** `.github/` · project root

**Problem**

The repository is public, Datacules-licensed open source, and the README invites use — but there is no `CONTRIBUTING.md`, no `CHANGELOG.md`, no issue templates, and no PR template. This raises the barrier for external contributors and creates unstructured noise in the issue tracker.

**Fix**

**`CONTRIBUTING.md`** — cover local setup, how to add a new provider adapter (implement `ProviderAdapter`, register in `PROVIDER_ADAPTERS`, write a test), how to write a routing rule, and coding conventions.

**`CHANGELOG.md`** — start from `v0.1.0`:

```markdown
## [0.1.0] — 2026-05-24
### Added
- Initial scaffold: identity types, auth patterns, credential vault UI, decision helper
- CredentialRouter with resourceKind-based routing
- Provider adapters for OpenAI, Anthropic, Gemini, Mistral, local
- CI pipeline: type-check, lint, build, smoke test
- Datacules open-source license
- Logo and branding assets
```

**`.github/ISSUE_TEMPLATE/bug.yml`** — fields for reproduction steps, expected vs actual behaviour, affected module, and provider (if relevant).

**`.github/ISSUE_TEMPLATE/feature.yml`** — fields for problem description, proposed solution, and affected auth pattern or identity type.

**Labels:** `open-source` `community` `devex`

---

## Recommended implementation order

| Phase | Findings | Timeline |
|---|---|---|
| **Phase 1 — Security foundation** | #1 server-side resolution · #3 unit tests · #7 credential expiry | Week 1 |
| **Phase 2 — Core correctness** | #2 multi-field routing · #5 CredentialStore interface · #9 decision helper gaps | Week 2 |
| **Phase 3 — Code quality** | #4 ghost dependencies · #6 wire activeProvider · #8 shared icons · #10 memoize router · #11 traceId | Week 2–3 |
| **Phase 4 — Polish** | #12 adapter stubs · #13 .env.example · #14 CONTRIBUTING / CHANGELOG / templates | Week 3 |

---

*This report was generated from a complete file-by-file read of the repository at commit `4975af5`. All findings reference specific files and line-level code. Each fix is concrete and immediately actionable.*

*© 2026 Datacules LLC*
