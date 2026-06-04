<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-libsql`

LibSQL (SQLite / Turso) persistence layer for the [agent-identity](https://github.com/hvrcharon1/agent-identity) framework.

Zero server. Zero native bindings required at runtime. One `npm install`.
Scales from a local embedded file to a globally distributed Turso database
by changing a single URL — no code changes.

## Install

```bash
npm install @datacules/agent-identity-store-libsql
```

## Quick Start

```typescript
import { createLibSqlStores }    from '@datacules/agent-identity-store-libsql';
import { createRouterFromStore } from '@datacules/agent-identity';

// ── Embedded (zero infrastructure) ──────────────────────────────────────────
const stores = await createLibSqlStores({ url: 'file:./agent-identity.db' });

// ── Distributed (Turso) — one URL swap, no code change ───────────────────────
const stores = await createLibSqlStores({
  url:       process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Wire into the router
const router = createRouterFromStore(
  stores.credentialStore,
  rules,
  stores.auditLogger,
);

// Wire into ApprovalManager
const approvals = new ApprovalManager(stores.approvalStore, notifiers);

// Wire into BudgetEnforcer
const budget = new BudgetEnforcer(stores.budgetStore);
```

## What's Included

| Class | Interface | Responsibility |
|---|---|---|
| `LibSqlCredentialStore` | `CredentialStore` | Credential metadata, lifecycle, reservation locks, OIDC revocation |
| `LibSqlApprovalStore` | `ApprovalStore` | Durable approval request queue |
| `LibSqlBudgetStore` | `BudgetStore` | Hourly sliding-window counters, daily spend |
| `LibSqlAuditLogger` | `MigrationAuditLogger` | Durable audit log + migration summary aggregation |
| `createLibSqlStores()` | — | One-call factory: opens connection, bootstraps schema, returns all four |
| `bootstrapSchema()` | — | Run the DDL directly against any `Client` you supply |

## Schema

Six tables are created automatically on first call to `createLibSqlStores()`:

```
ai_credentials          — credential metadata + OIDC identity fields
ai_reservations         — migration lock records (TTL-based)
ai_approval_requests    — approval workflow state machine
ai_budget_hourly        — sliding-window hourly resolution counters
ai_budget_daily         — daily spend accumulators
ai_audit_log            — full audit trail (standard + migration entries)
```

All `CREATE TABLE` statements use `IF NOT EXISTS` — safe to run on every
startup, no migration runner required.

## Scaling: Embedded → Distributed

```
Development / single-instance:
  url: 'file:./agent-identity.db'   ← SQLite file, zero infra
  url: ':memory:'                   ← in-memory, tests and ephemeral agents

Multi-instance / global:
  url: 'libsql://my-db.turso.io'    ← Turso cloud, shared state
  url: 'https://my-db.turso.io'     ← HTTPS mode
```

The router, approval manager, and budget enforcer see a uniform
`CredentialStore` / `ApprovalStore` / `BudgetStore` interface — they don't
know or care whether the backing store is local or distributed.

## Seeding Credentials

`LibSqlCredentialStore` exposes an `upsert()` method (not part of the core
interface) for seeding credentials on startup:

```typescript
await stores.credentialStore.upsert({
  id:       'cred-openai-prod',
  kind:     'fixed',
  name:     'OpenAI Production Key',
  scope:    'all-projects',
  status:   'active',
  provider: 'openai',
  ref:      'openai-prod-slot',
  tags:     ['prod'],
  // Optional: record OIDC identity for revokeByIdentity() support
  identityIssuer:   'https://auth.openai.com',
  identitySubject:  'user-42',
  identityAudience: 'https://api.datacules.com',
});
```

## Combining with Hash-Chain Audit Logging

`LibSqlAuditLogger` provides durable storage. For tamper-evident logging,
wrap it with `HashChainAuditLogger` from `@datacules/agent-identity-audit`:

```typescript
import { HashChainAuditLogger } from '@datacules/agent-identity-audit';

const auditLogger = new HashChainAuditLogger(stores.auditLogger);
// Now every entry is chained AND persisted to SQLite
```

## Test Pattern

All four stores accept a `Client` in their constructor — inject a mock
client in tests without needing a real database:

```typescript
import { LibSqlCredentialStore } from '@datacules/agent-identity-store-libsql';
import { vi } from 'vitest';

const mockExecute = vi.fn();
const mockClient  = { execute: mockExecute } as never;
const store = new LibSqlCredentialStore(mockClient);

mockExecute.mockResolvedValue({ rows: [...], rowsAffected: 0 });
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity)
by [Datacules LLC](https://datacules.com).
