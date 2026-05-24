# Auth Patterns Reference

## Individual user auth

Each request carries the calling user's own token. The agent forwards it — or exchanges it for a scoped downstream token — to the target resource.

**When to use**: Users have different access levels. The agent must respect per-user entitlements.

**Tradeoff**: More credential management overhead. Each user must have a token provisioned.

---

## Fixed credential

A single service account credential lives in the agent's config. All users get identical access.

**When to use**: Shared tools where all users are equal — Linear boards, internal wikis, analytics dashboards.

**Tradeoff**: No per-user traceability at the credential level. Supplement with request-level audit logging.

---

## Context-switched (hybrid)

The agent inspects each task and selects the right credential: fixed for shared resources, user-delegated for personal data.

**When to use**: Agent touches both shared and personal resources in the same workflow.

**Tradeoff**: More complex routing logic. Routing rules must be explicitly defined and tested.

---

## Token exchange / impersonation

The agent holds an elevated credential and exchanges it for a scoped user token at runtime using OAuth token exchange or STS assume-role.

**When to use**: Advanced flows where the agent must act as a specific user without storing per-user tokens long-term.

**Tradeoff**: Requires a token exchange endpoint. Scope constraints must be strictly enforced.
