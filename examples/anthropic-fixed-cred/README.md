# Example: Anthropic + Fixed Service-Account Credential

The simplest agent-identity pattern: a single fixed API key used for all requests. All users are equal — no per-user credential management. Supplement with audit logging for traceability.

**Use when:** internal tools, wikis, task boards, shared team resources.
**Avoid when:** users have different access levels to the same resource.

## Flow

```
Any user request
  └── router.resolve({ provider: 'anthropic', resourceKind: 'shared', ... })
        └── matches rule-all-anthropic (catch-all)
              └── ResolvedCredential { ref: 'vault:anthropic/service-account-slot' }
                    └── anthropicAdapter.injectCredential(resolved, requestConfig)
                          └── Anthropic API call (x-api-key set server-side)
```

## Run

```bash
cd examples/anthropic-fixed-cred
npm install
node index.js
```

Expected output:
```
=== Fixed credential routing ===
All users resolve to the same service account.

[user-anna]
  credential: cred-anthropic-service (fixed)
  ref       : vault:anthropic/service-account-slot
  valid     : true

[user-bob]
  credential: cred-anthropic-service (fixed)
  ref       : vault:anthropic/service-account-slot
  valid     : true

...
```

## Traceability without per-user credentials

Even with a fixed credential, every resolution is audited with `userId`, `traceId`, `action`, and `resourceId`. If an incident occurs you can trace every AI action back to the originating user — you just can't revoke one user's access independently.

If per-user revocation is a requirement, use the [user-delegated example](../openai-user-delegated/) instead.

## Credential rotation

Add a `rotationIntervalDays` field to trigger rotation events:

```javascript
// router emits a `credential.rotation_due` audit event 3 days before expiry
// and `credential.rotated` when the new credential is in place
rotationIntervalDays: 30,
```

See [`@datacules/agent-identity`](../../packages/core/) for the `CredentialRotationScheduler` docs.
