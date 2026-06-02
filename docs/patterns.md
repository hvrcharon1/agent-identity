<p align="center">
  <img src="../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# Auth Patterns Reference

Six patterns cover the full space of real-world agentic auth requirements.

---

## Pattern 1 — Individual user auth

Each request carries the calling user's own token. The agent forwards it — or exchanges it for a scoped downstream token — to the target resource.

**When to use:** Users have different access levels to the same resource. The agent must respect per-user entitlements.

**Tradeoff:** More credential management overhead. Each user must have a token provisioned.

**Dashboard tab:** Credentials → user-delegated slot.

---

## Pattern 2 — Fixed credential

A single service account credential lives in the agent’s config. All users get identical access.

**When to use:** Shared tools where all users are equal — Linear boards, internal wikis, analytics dashboards.

**Tradeoff:** No per-user traceability at the credential level. Supplement with request-level audit logging.

**Dashboard tab:** Credentials → fixed slot.

---

## Pattern 3 — Context-switched (hybrid)

The agent inspects each task and selects the right credential: fixed for shared resources, user-delegated for personal data.

**When to use:** Agent touches both shared and personal resources in the same workflow.

**Tradeoff:** More complex routing logic. Routing rules must be explicitly defined and tested.

**Dashboard tab:** Auth patterns → Hybrid.

---

## Pattern 4 — Token exchange (RFC 8693)

The agent holds an elevated credential and exchanges it for a scoped user token at runtime using OAuth 2.0 token exchange at any AS (Keycloak, Auth0, Azure AD, Okta).

**When to use:** Agent must act as a specific user without storing per-user tokens long-term.

**Tradeoff:** Requires a token exchange endpoint. Scope constraints must be strictly enforced.

**Package:** `@datacules/agent-identity-token-exchange` — `TokenExchangeStore` implements `CredentialStore`; exchanged tokens are cached with a 30-second expiry buffer.

**Dashboard tab:** Token exchange.

---

## Pattern 5 — Data migration (phase-aware)

The agent reads from one system and writes to another across multiple phases (`dry-run`, `extract`, `transform`, `load`, `verify`, `rollback`). Each phase gets its own credential via `resolvePair()`.

**When to use:** Any AI-assisted migration run that crosses credential boundaries.

**Tradeoff:** Phase-aware routing rules required. Use `resolvePair()` and `reserve()` / `release()` for correctness.

**Key API:**
```typescript
const pair = router.resolvePair(migrationCtx);
// pair.source — read credential for sourceResourceId
// pair.target — write credential for targetResourceId
```

**Dashboard tab:** Data migration.

---

## Pattern 6 — Workload identity (SPIFFE / SPIRE)

No static credentials. The agent is attested by SPIRE and receives a short-lived X.509 SVID that serves as its identity. `SpiffeCredentialStore` auto-renews the SVID from the SPIRE workload API socket.

**When to use:** Zero-trust environments where storing any static secret is unacceptable.

**Tradeoff:** Requires a SPIRE deployment. SVID trust domain must be configured.

**Routing rule:**
```typescript
{
  id: 'rule-orders-agent',
  matchSpiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent',
  credentialRef: 'orders-db-slot',
  priority: 90,
}
```

**Dashboard tab:** SPIFFE / SPIRE.

---

## Decision tree

```
Are access levels different per user?
  ├── YES → Individual user auth (or Token exchange if no per-user storage)
  └── NO
        ├── Is this a migration run?  → Data migration (phase-aware)
        ├── Zero-trust / no secrets?  → SPIFFE / SPIRE workload identity
        ├── Mixed personal + shared?   → Context-switched (hybrid)
        └── All equal access           → Fixed credential
```

Use the **Decision Helper** tab in the dashboard to get a recommendation from three yes/no questions.
