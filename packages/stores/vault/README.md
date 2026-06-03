<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-vault`

HashiCorp Vault KV v2 credential store for the agent-identity framework. Drop-in replacement for `MemoryCredentialStore`.

## Install

```bash
npm install @datacules/agent-identity-store-vault
```

## Usage

```typescript
import { VaultCredentialStore }  from '@datacules/agent-identity-store-vault';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new VaultCredentialStore({
  address:    process.env.VAULT_ADDR!,   // e.g. 'https://vault.acme.com'
  token:      process.env.VAULT_TOKEN!,  // or use AppRole / Kubernetes auth
  mountPath:  'secret',                  // KV v2 mount (default: 'secret')
  pathPrefix: 'agent-identity/',         // all credential secrets live under this path
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```

## What it does

- **`findByRef(ref)`** — reads `<mountPath>/data/<pathPrefix><ref>` from Vault KV v2.
- **`reserve(ref, migrationId, ttl)`** — writes a lease to Vault to lock a credential for migration.
- **`release(ref, migrationId)`** — deletes the lease.
- **`listActive()` / `listByKind()`** — lists secrets under the path prefix.

## Vault policy

```hcl
path "secret/data/agent-identity/*" {
  capabilities = ["read", "list"]
}
path "secret/data/agent-identity/locks/*" {
  capabilities = ["create", "read", "update", "delete"]
}
```

## Rotation integration

`VaultCredentialStore` implements `RotationProvisioner` from `packages/core`, so you can pair it with `CredentialRotationScheduler` to automatically rotate secrets in Vault and hot-swap the active credential ref with zero downtime.

```typescript
import { CredentialRotationScheduler } from '@datacules/agent-identity';
import { VaultRotationProvider }       from '@datacules/agent-identity-store-vault';

const scheduler = new CredentialRotationScheduler({
  store,
  provisioner: new VaultRotationProvider(store),
  policies: [{ credentialId: 'cred-db-prod', rotateAfterDays: 30 }],
});
await scheduler.runOnce();
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
