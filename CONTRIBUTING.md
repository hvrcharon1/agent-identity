# Contributing to agent-identity

Thank you for your interest in contributing! This guide covers local setup, how to add a new provider adapter, how to write routing rules, and our coding conventions.

## Local setup

```bash
git clone https://github.com/hvrcharon1/agent-identity.git
cd agent-identity
npm install
cp .env.example .env.local   # fill in any values you need
npm run dev
```

The app runs at `http://localhost:3000`.

## Running tests

```bash
npm test            # single run
npm run test:watch  # watch mode
npm run type-check  # TypeScript
npm run lint        # ESLint
```

## Adding a new provider adapter

1. Open `src/lib/providers.ts`.
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
};
```

3. Add `'my-provider'` to the `SupportedProvider` union in `src/lib/types.ts`.
4. Register it in `PROVIDER_ADAPTERS`.
5. Write tests in `src/lib/providers.test.ts` covering `injectCredential` and `validate`.

## Writing a routing rule

Routing rules live in `src/lib/credentials.ts` (`DEFAULT_ROUTING_RULES`) and follow the `RoutingRule` interface:

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
}
```

Omit any `match*` field to match any value for that dimension.

## Coding conventions

- TypeScript strict mode — no `any` unless annotated with a comment.
- All new logic files need a corresponding `.test.ts` file.
- Icons go in `src/components/icons.tsx` — do not add inline SVG duplicates.
- Credential secrets never touch the client bundle — resolve server-side via `/api/resolve`.
- Follow the existing file header comment style for new `src/lib/` files.

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes and add tests.
3. Run `npm test && npm run type-check && npm run lint` — all must pass.
4. Open a PR against `main` with a clear description of what and why.

Please use the GitHub issue templates for bugs and feature requests before opening a PR.
