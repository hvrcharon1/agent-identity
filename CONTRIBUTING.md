<p align="center">
  <img src="assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="380"/>
</p>

# Contributing to agent-identity

Thank you for your interest in contributing! This guide covers local setup, how to add a new provider adapter, how to write routing rules, and our coding conventions.

## Local setup

```bash
git clone https://github.com/hvrcharon1/agent-identity.git
cd agent-identity
npm install --legacy-peer-deps
cp .env.example .env.local   # fill in any values you need
npm run dev
```

The app runs at `http://localhost:3000`.

> **Note:** The monorepo uses npm workspaces. Always pass `--legacy-peer-deps` when
> running `npm install` so workspace cross-dependencies resolve correctly.

## Running tests

```bash
npm test            # single run (all 19 workspace packages)
npm run test:watch  # watch mode
npm run type-check  # TypeScript (root + src/)
npm run lint        # ESLint
```

## Repository layout

```
agent-identity/
├── packages/
│   ├── core/                  # @datacules/agent-identity (router, types, Zod schemas, React hook)
│   ├── audit/                 # @datacules/agent-identity-audit (hash-chain logger, sinks)
│   ├── stores/                # cloud credential stores (aws, vault, azure, spiffe, dynamic)
│   ├── integrations/          # framework adapters (express, fastify, nestjs, langchain, mcp,
│   │                          #   mcp-client, otel, anomaly, compliance, token-exchange)
│   ├── cli/                   # @datacules/agent-identity-cli (audit verify, report, health)
│   └── python-sdk/            # pip install datacules-agent-identity
├── src/                   # Next.js 14 dashboard app (17 interactive tabs)
├── assets/logo.svg        # master brand mark (source of truth)
├── public/logo.svg        # static copy served by Next.js at /logo.svg
└── docs/                  # supplementary reference guides
```

## Adding a new provider adapter

1. Open `packages/core/src/providers.ts`.
2. Create a new `ProviderAdapter` object:

```typescript
const myProviderAdapter: ProviderAdapter = {
  id: 'my-provider',        // must match SupportedProvider union in types.ts
  label: 'My Provider',
  injectCredential(request, credential) {
    // Return a new request object with the credential injected.
    // API key goes in a server-side header — never in the body.
    return {
      ...request,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'X-My-Provider-Key header (server-side)',
      },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[my-provider] request.model is required');
  },
  validateForMigration(credential, phase) {
    // Enforce scope constraints before data moves
    if ((phase === 'load' || phase === 'rollback') && !credential.scope?.includes('write')) {
      throw new Error(`[my-provider] write scope required for phase '${phase}'`);
    }
  },
};
```

3. Add `'my-provider'` to the `SupportedProvider` union in `packages/core/src/types.ts`.
4. Register it in `PROVIDER_ADAPTERS` in `packages/core/src/providers.ts`.
5. Write tests in `packages/core/src/providers.test.ts` covering `injectCredential`, `validate`, and `validateForMigration`.

## Writing a routing rule

Routing rules live in `src/lib/credentials.ts` (`DEFAULT_ROUTING_RULES`) and follow the `RoutingRule` interface from `packages/core/src/types.ts`:

```typescript
{
  id: 'rule-my-rule',
  description: 'What this rule does',
  credentialRef: 'my-cred-slot',
  credentialKind: 'fixed',           // or 'user-delegated'
  priority: 20,                      // higher wins
  matchResourceKind: 'shared',       // optional
  matchAction: ['read', 'write'],    // optional
  matchProvider: 'anthropic',        // optional
  matchUserId: 'user-abc',           // optional
  matchSpiffeId: 'spiffe://...',     // optional — SPIFFE workload match
  matchPhase: 'extract',             // optional — migration phase match
  canaryRef: 'cred-v2',             // optional — gradual rollout
  canaryWeight: 5,                   // optional — % of traffic to canary
}
```

Omit any `match*` field to match any value for that dimension.

## Adding a new package to the monorepo

1. Create the directory under the appropriate subtree (`packages/stores/`, `packages/integrations/`, or `packages/` directly).
2. Add a `package.json` with `"name": "@datacules/agent-identity-<name>"` and `"version": "0.1.0"`.
3. Add the workspace path to the root `package.json` `workspaces` array.
4. Add source aliases for Vitest to `vitest.config.ts` (see existing entries as a pattern).
5. Add a build script to `turbo.json` if the package needs a pre-publish build.
6. Write tests in `src/*.test.ts` — they are automatically picked up by the root vitest config.

## Coding conventions

- TypeScript strict mode — no `any` unless annotated with a comment.
- All new logic files need a corresponding `.test.ts` file.
- Icons go in `src/components/icons.tsx` — do not add inline SVG duplicates.
- Credential secrets never touch the client bundle — resolve server-side via `/api/resolve`.
- Follow the existing file header comment style for new `packages/core/src/` files.
- When adding a new dashboard tab: add the tab entry to the `TABS` constant in `src/app/page.tsx`, create the component in `src/components/`, and update the README dashboard table.

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes and add tests.
3. Run `npm test && npm run type-check && npm run lint` — all must pass.
4. Open a PR against `main` with a clear description of what and why.

Please use the GitHub issue templates for bugs and feature requests before opening a PR.

---

<p align="center">
  Built at <a href="https://datacules.com">Datacules LLC</a> — open source, provider-agnostic, production-grade.
</p>
