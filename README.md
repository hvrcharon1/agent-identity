<p align="center">
  <img src="assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="520"/>
</p>

<p align="center">
  <strong>Agent Identity & Auth Patterns</strong><br/>
  <sub>A provider-agnostic framework by <a href="https://datacules.com">Datacules LLC</a></sub>
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Datacules%20Open%20Source-black?style=flat-square" alt="License"/>
  </a>
  <a href="https://github.com/hvrcharon1/agent-identity/stargazers">
    <img src="https://img.shields.io/github/stars/hvrcharon1/agent-identity?style=flat-square&color=black" alt="Stars"/>
  </a>
  <img src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Mistral%20%7C%20Local-black?style=flat-square" alt="Supported providers"/>
  <img src="https://img.shields.io/badge/stack-Next.js%20%2B%20TypeScript-black?style=flat-square" alt="Stack"/>
</p>

---

> **AI agents are executing real actions — merging code, modifying databases, sending emails, calling APIs on behalf of real people. The question of *who* the agent is acting as, and *with which credentials*, is no longer academic. It is a production-grade engineering concern.**

A provider-agnostic framework for AI agents that act on behalf of users and services — with precise, auditable credential routing. Works with OpenAI, Anthropic, Gemini, Mistral, and local models out of the box.

---

## Why this exists — the identity problem in agentic AI

Every AI agent that touches a real system must answer three questions before it acts:

1. **Who am I acting as?** — a specific user, a shared service account, or the agent itself?
2. **Which credential do I use?** — the user's own token, or a fixed service key?
3. **When do I switch between them?** — if the agent handles both shared and personal resources in the same workflow, the answer changes per task.

Without an explicit answer to all three, you get one of these failure modes in production:

- An agent silently acts with more privilege than the user it represents (credential escalation)
- A breach exposes raw API keys because the model layer received them directly
- An audit trail that says "the agent did it" — with no traceable human principal behind the action
- A multi-agent pipeline where intermediate hops are completely anonymous

`agent-identity` makes those decisions explicit, configurable, and auditable — across any AI provider.

---

## The two patterns that cover most real-world cases

### Pattern 1 — Fixed credential (shared resource access)

```
User 1 ─┐
User 2 ──▶  [ AI Agent ]  ──▶  Fixed Auth  ──▶  Linear board
User 3 ─┘                                        (all users have same access)
```

All users interact through the same agent, which authenticates to the downstream resource using a single shared service account. The right choice when all users are peers — shared task boards, internal wikis, analytics dashboards. Simple, low-overhead, but supplement with request-level audit logging since the credential itself carries no per-user signal.

### Pattern 2 — Individual user auth (variable access)

```
User 1 ──[ User 1 Auth ]─┐
User 2 ──[ User 2 Auth ]──▶  [ AI Agent ]  ──▶  Individual User Auth  ──▶  Company knowledge base
User 3 ──[ User 3 Auth ]─┘                                                   (variable document access)
```

Each user brings their own token. The agent forwards or scopes it — it cannot do more than that user is already permitted to do. The right choice wherever users have different entitlements: personal files, role-gated documents, HR systems, financial data. More credential management overhead, but the only architecturally sound choice when access levels differ.

These two patterns, plus **hybrid / context-switched** (both in one workflow) and **token exchange / impersonation** (OAuth STS), cover the full space of real-world agentic auth requirements.

---

## Why this matters right now

### The pace of agentic AI adoption is outrunning its infrastructure

In 2024–2026, AI agents moved from demos to production at a speed the supporting tooling did not anticipate. Frameworks for building agents (LangChain, LangGraph, AutoGen, CrewAI, Claude Code, OpenAI Assistants) matured rapidly. The frameworks for *governing* those agents — identity, credential management, audit, least-privilege enforcement — lagged behind.

The result is a generation of agentic systems that are powerful but fragile on the security and accountability dimensions:

- Most agent implementations pass raw API keys or tokens directly into the context window, where the model layer can log, replay, or leak them.
- Audit trails typically record what model was called, not *on whose behalf* and *with whose privilege*.
- Multi-agent orchestration (agent calling agent calling tool) creates anonymous action chains with no traceable principal at intermediate hops.
- Provider lock-in at the credential layer means changing from OpenAI to Anthropic requires re-engineering auth, not just swapping a model string.

`agent-identity` was built to close each of these gaps systematically.

### The regulatory environment is catching up

GDPR, SOC 2, ISO 27001, and emerging AI-specific frameworks (EU AI Act, NIST AI RMF) are beginning to ask the same questions about AI agents that they ask about human users: who acted, on whose behalf, with what authority, and is there a log? Organisations deploying agents in customer-facing, financial, or healthcare contexts will need to answer these questions in audits. A system where "the agent did it" is the only available answer will not pass.

### Multi-agent pipelines are becoming the default architecture

The shift from single-agent to multi-agent architectures (orchestrator → sub-agents → tool agents) is already well underway. In a pipeline of five agents, if each hop doesn't carry a traceable identity, the blast radius of any misconfiguration or compromise is the entire pipeline. The `agent-as-service` identity type in this framework directly addresses this: each agent in a pipeline has its own machine identity, every hop is tagged, and the full chain is reconstructible from the audit log.

### Provider diversity is here to stay

No single AI provider will dominate every use case. Cost, capability, latency, data-residency requirements, and compliance constraints mean most production systems already use or plan to use multiple providers. `agent-identity`'s `ProviderAdapter` interface normalises credential injection across OpenAI, Anthropic, Gemini, Mistral, and local models — your routing rules, audit logs, and identity configuration don't change when you change the model underneath.

---

## Auth patterns

| Pattern | Use when | Tradeoff |
|---|---|---|
| **Individual user auth** | Users have different access levels to the same resource | More credential management; each user needs a token provisioned |
| **Fixed credential** | All users are equal (shared task boards, wikis) | No per-user traceability at the credential level; supplement with audit logging |
| **Hybrid / context-switched** | Agent touches both shared and personal resources in one workflow | More complex routing logic; rules must be explicitly defined and tested |
| **Token exchange** | Agent must act as a specific user without storing per-user tokens long-term | Requires a token exchange endpoint; scope constraints must be strictly enforced |

---

## Security principles

- **Credentials are stored encrypted at rest** — the vault stores refs, not raw secrets
- **The model layer never receives raw credentials** — the router injects them at call time via the provider adapter
- **Every agent action is tagged with the resolved identity** — `userId`, `action`, `resource`, `credentialId`, `resolvedFor` written to the audit log on every routed request
- **Least-privilege by design** — user-delegated tokens are scoped to what that user already has; the agent cannot escalate
- **No credential escalation path** — the routing engine has no mechanism to elevate a user-delegated token beyond its original scope

---

## Core concepts

### Identity types

- **User-delegated** — agent uses each user's own OAuth token or API key; enforces per-user entitlements
- **Fixed service** — agent uses a single shared service account; right for shared, equal-access resources
- **Hybrid** — agent selects the right credential per task within one workflow
- **Agent-as-service** — agent has its own machine identity; essential for multi-agent pipelines where agents call agents

### Credential routing

The routing engine (`src/lib/router.ts`) inspects each outbound call and selects the correct credential based on:
- Target resource type (`shared` vs `personal`)
- Calling user's identity context
- Configured `RoutingRule[]`

The model layer **never** sees raw credentials. The router injects them at call time via the provider adapter, and writes an audit entry tagging `userId`, `action`, `resource`, `credentialId`, and `resolvedFor`.

### Provider adapters

Adapters in `src/lib/providers.ts` normalise credential injection across providers. Add a new provider by implementing the `ProviderAdapter` interface — your routing rules and audit configuration are untouched.

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The Decision Helper wizard (`/decide`) walks you through three questions — variable access levels, mixed resource types, per-user audit requirements — and recommends the right auth pattern for your use case.

---

## Project structure

```
agent-identity/
├── assets/
│   └── logo.svg                  # Datacules brand mark
├── src/
│   ├── app/                      # Next.js app router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Main dashboard
│   │   ├── identities/           # Identity type management
│   │   ├── patterns/             # Auth pattern configuration
│   │   ├── credentials/          # Credential vault UI
│   │   └── decide/               # Decision helper wizard
│   ├── components/
│   │   ├── ui/                   # Shared UI primitives
│   │   ├── IdentityCard.tsx
│   │   ├── PatternRow.tsx
│   │   ├── FlowDiagram.tsx
│   │   ├── CredentialVault.tsx
│   │   └── DecisionHelper.tsx
│   ├── lib/
│   │   ├── types.ts              # Core type definitions
│   │   ├── patterns.ts           # Auth pattern definitions
│   │   ├── credentials.ts        # Credential store abstraction
│   │   ├── router.ts             # Credential routing engine
│   │   └── providers.ts          # AI provider adapters
│   └── hooks/
│       ├── useIdentity.ts
│       ├── useCredentials.ts
│       └── useRouter.ts
├── docs/
│   ├── patterns.md               # Auth pattern reference
│   ├── credential-routing.md     # Router internals
│   └── provider-integration.md  # Adding new providers
├── examples/
│   ├── openai-user-delegated/    # Per-user token with OpenAI
│   ├── anthropic-fixed-cred/     # Fixed service account with Anthropic
│   └── hybrid-routing/           # Context-switched in one workflow
├── package.json
├── tsconfig.json
└── next.config.js
```

---

## Adding a routing rule

```typescript
import type { RoutingRule } from '@/lib/types';

const rule: RoutingRule = {
  id: 'rule-personal-docs',
  resourceKind: 'personal',        // 'shared' | 'personal'
  credentialKind: 'user-delegated', // 'fixed' | 'user-delegated'
  credentialRef: 'user-oauth-ref',  // opaque slot identifier — never a raw secret
  description: 'Use the calling user\'s own token for personal document access.',
};
```

The router matches on `resourceKind`, resolves the credential ref server-side, injects it via the provider adapter, and writes the audit entry. The model never sees the credential.

---

## Supported providers

| Provider | Adapter | Example |
|---|---|---|
| OpenAI | `openai` | `examples/openai-user-delegated/` |
| Anthropic | `anthropic` | `examples/anthropic-fixed-cred/` |
| Gemini | `gemini` | — |
| Mistral | `mistral` | — |
| Local models | `local` | `examples/hybrid-routing/` |

Implement `ProviderAdapter` to add any provider in minutes.

---

## License

Copyright © 2026 Datacules LLC. Released under the [Datacules Open Source License](LICENSE) — permissive, commercial-friendly, no copyleft requirement.
