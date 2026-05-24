# Example: OpenAI + User-Delegated Auth

This example shows how to use the agent identity router with OpenAI where each user authenticates with their own API key or OAuth token.

## Flow

```
User N request → Agent → Resolve user N's token → OpenAI API (as user N)
```

## Setup

1. Add each user's OpenAI token to your encrypted credential store keyed by user ID.
2. Configure a routing rule: `resourceKind: 'personal' → credentialKind: 'user-delegated'`.
3. At request time, call `router.resolve(ctx)` and inject via the OpenAI adapter.

## Key principle

The model never sees the credential. The router resolves and injects it in the request pipeline before the API call is made.
