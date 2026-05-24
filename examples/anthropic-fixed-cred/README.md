# Example: Anthropic + Fixed Service Credential

This example shows how to use a single Anthropic API key shared across all users — appropriate for agents with uniform access needs (shared knowledge bases, wikis, task boards).

## Flow

```
Any user → Agent → Fixed Anthropic API key → Shared resource
```

## Setup

1. Store your Anthropic API key in an encrypted secrets manager.
2. Configure a routing rule: `resourceKind: 'shared' → credentialKind: 'fixed'`.
3. The router injects the fixed credential for every request regardless of the calling user.

## Key principle

All users get identical access. Supplement with request-level tagging in your own logs if you need to track which user triggered which agent action.
