# Example: Hybrid Credential Routing

This example shows a context-switched agent that uses different credentials depending on whether the task targets a shared or personal resource.

## Flow

```
Task arrives
  ├── shared resource?  → Fixed service account
  └── personal resource? → User's delegated token
```

## Setup

1. Configure both a fixed credential and a user-delegated credential slot.
2. Add two routing rules:
   - `resourceKind: 'shared' → fixed credential`
   - `resourceKind: 'personal' → user-delegated token`
3. Tag each incoming task with its `resourceKind` in your agent's context builder.

## Key principle

The routing rules are explicit, logged, and auditable. Every agent action records which credential was used and for whom — giving you full traceability without requiring per-user setup for every shared tool.
