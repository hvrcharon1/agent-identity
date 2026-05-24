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
</p>

---

A provider-agnostic framework for AI agents that act on behalf of users and services — with precise, auditable credential routing.

## What this solves

When an AI agent acts on behalf of a user, it needs to answer three questions clearly:

1. **Who am I acting as?** (identity type)
2. **Which credentials do I use?** (fixed service account vs user-delegated token)
3. **When do I switch between them?** (routing rules)

This app makes those decisions explicit, configurable, and auditable — across any AI provider (OpenAI, Anthropic, Gemini, Mistral, local models).

## Auth patterns

| Pattern | Use when |
|---|---|
| **Individual user auth** | Users have different access levels to the same resource |
| **Fixed credential** | All users are equal (shared task boards, wikis) |
| **Hybrid / context-switched** | Agent touches both shared and personal resources |
| **Token exchange** | Agent needs to impersonate users via OAuth / STS |

## Project structure

```
agent-identity/
├── assets/
│   └── logo.svg              # Datacules brand mark
├── src/
│   ├── app/                  # Next.js app router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Main dashboard
│   │   ├── identities/       # Identity type management
│   │   ├── patterns/         # Auth pattern configuration
│   │   ├── credentials/      # Credential vault UI
│   │   └── decide/           # Decision helper wizard
│   ├── components/
│   │   ├── ui/               # Shared UI primitives
│   │   ├── IdentityCard.tsx
│   │   ├── PatternRow.tsx
│   │   ├── FlowDiagram.tsx
│   │   ├── CredentialVault.tsx
│   │   └── DecisionHelper.tsx
│   ├── lib/
│   │   ├── types.ts          # Core type definitions
│   │   ├── patterns.ts       # Auth pattern definitions
│   │   ├── credentials.ts    # Credential store abstraction
│   │   ├── router.ts         # Credential routing engine
│   │   └── providers.ts      # AI provider adapters
│   └── hooks/
│       ├── useIdentity.ts
│       ├── useCredentials.ts
│       └── useRouter.ts
├── docs/
│   ├── patterns.md
│   ├── credential-routing.md
│   └── provider-integration.md
├── examples/
│   ├── openai-user-delegated/
│   ├── anthropic-fixed-cred/
│   └── hybrid-routing/
├── package.json
├── tsconfig.json
└── next.config.js
```

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Core concepts

### Identity types

- **User-delegated** — agent uses each user's own OAuth token / API key
- **Fixed service** — agent uses a single shared service account
- **Hybrid** — agent picks the right credential per task
- **Agent-as-service** — agent has its own machine identity (multi-agent pipelines)

### Credential routing

The routing engine (`src/lib/router.ts`) inspects each outbound call and selects the correct credential based on:
- Target resource type (shared vs personal)
- Calling user's identity context
- Configured routing rules

The model layer **never** sees raw credentials. The router injects them at call time.

### Provider adapters

Adapters in `src/lib/providers.ts` normalize credential injection across providers. Add a new provider by implementing the `ProviderAdapter` interface.

## Security principles

- Credentials are stored encrypted at rest
- The AI model layer never receives raw credentials
- Every agent action is tagged with the resolved identity for audit
- Least-privilege: user-delegated tokens are scoped to what that user already has

## License

Copyright © 2026 Datacules LLC. Released under the [Datacules Open Source License](LICENSE) — permissive, commercial-friendly, no copyleft requirement.
