# `@datacules/agent-identity-store-dynamic`

Just-in-time credential provisioning for [`@datacules/agent-identity`](../../core). Credentials don't exist until the agent requests them — minted on demand with a short TTL, revoked automatically by the upstream system.

## Install

```bash
npm install @datacules/agent-identity-store-dynamic
```

## Why JIT?

With static credential stores, long-lived secrets sit at rest — if the store is compromised, every credential in it is exposed. With JIT provisioning, there are no stored secrets: the store calls your vault on every resolution and gets back a short-lived lease. After the TTL (15–60 minutes) the upstream system revokes the secret automatically. The blast radius of any store compromise collapses to a single active session at most.

## Usage

### Vault dynamic secrets

```typescript
import { DynamicCredentialStore, VaultDynamicProvisioner } from '@datacules/agent-identity-store-dynamic';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new DynamicCredentialStore({
  provisioner: new VaultDynamicProvisioner({
    vaultAddr: 'http://vault:8200',
    token: process.env.VAULT_TOKEN!,
    mount: 'database',
    role: 'crm-readonly',
    ttl: '30m',
  }),
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
// resolved.ref → Vault lease ID — use this to fetch the actual secret server-side
// resolved.expiresAt → when the lease expires
```

### AWS IAM Roles Anywhere

```typescript
import { DynamicCredentialStore, AwsRolesAnywhereProvisioner } from '@datacules/agent-identity-store-dynamic';

const store = new DynamicCredentialStore({
  provisioner: new AwsRolesAnywhereProvisioner({
    profileArn: 'arn:aws:rolesanywhere:us-east-1:...',
    roleArn: 'arn:aws:iam::...:role/agent-role',
    trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:...',
    region: 'us-east-1',
    durationSeconds: 3600,
  }),
});
```

### Custom provisioner

```typescript
import type { DynamicProvisioner, ProvisionedSecret } from '@datacules/agent-identity-store-dynamic';

class MyProvisioner implements DynamicProvisioner {
  id = 'my-vault';

  async provision(ref: string): Promise<ProvisionedSecret> {
    // Call your secret management system here
    const { leaseId, ttlSeconds, secret } = await myVault.issue(ref);
    return {
      leaseId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      secret,
    };
  }

  async revoke(leaseId: string): Promise<void> {
    await myVault.revoke(leaseId);
  }
}
```

## Caching

By default, unexpired leases are cached in memory and reused until 60 seconds before expiry (configurable via `renewBeforeExpireSeconds`). Set `cache: false` to provision a fresh lease on every resolution.
