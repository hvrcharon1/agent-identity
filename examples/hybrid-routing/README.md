# Example: Hybrid / Context-Switched Credential Routing

A single agent session touches both shared resources (wiki, task board) and personal resources (user's calendar, documents). The router automatically selects the right credential for each resource kind — no conditional logic in application code.

## Flow

```
Agent request arrives
  ├── resourceKind: 'shared'
  │     └── matches rule-shared (priority 10)
  │           └── fixed service account  →  all shared actions logged against org
  │
  └── resourceKind: 'personal'
        └── matches rule-{userId}-personal (priority 30)
              └── user's own delegated token  →  action logged against that user
```

Priority rules ensure per-user rules always win over the shared fallback.

## Run

```bash
cd examples/hybrid-routing
npm install
node index.js
```

Expected output:
```
=== Hybrid routing simulation ===

🔧 Read shared wiki
   user       : user-carol
   resource   : company-wiki (shared)
   credential : cred-service-anthropic (fixed)
   ref        : vault:anthropic/service-account-slot

👤 Write to personal documents
   user       : user-carol
   resource   : carol-private-docs (personal)
   credential : cred-user-carol (user-delegated)
   ref        : vault:anthropic/user-carol-slot

🔧 Dave reads shared task board
   user       : user-dave
   resource   : team-task-board (shared)
   credential : cred-service-anthropic (fixed)
   ref        : vault:anthropic/service-account-slot
```

## Extending the rules

Add provider-specific routing (e.g., Gemini for search tasks, Anthropic for analysis):

```javascript
// Route shared search tasks to Gemini
{
  id: 'rule-shared-search-gemini',
  credentialRef: 'vault:gemini/service-account-slot',
  priority: 15,
  matchResourceKind: 'shared',
  matchProvider: 'gemini',
  matchAction: 'search',
}
```

## Key principles

- **Zero conditional logic** in application code — routing is declarative, in the rule config
- **Priority scoring** means per-user rules always take precedence over the shared fallback
- **Every action is audited** — shared actions log against the service account; personal actions log against the individual user
- **Extensible** — adding a new user requires only one new credential + one new rule
