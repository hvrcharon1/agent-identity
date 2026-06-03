<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-dynamic`

JIT (Just-in-Time) credential provisioning store for the agent-identity framework. Mints short-lived secrets on demand via Vault dynamic secrets, AWS IAM Roles Anywhere, or Azure Managed Identity. Zero static secrets at rest.

## Install

```bash
npm install @datacules/agent-identity-store-dynamic
```

## Usage

```typescript
import { DynamicCredentialStore }  from '@datacules/agent-identity-store-dynamic';
import { createRouterFromStore }  from '@datacules/agent-identity';

// Vault dynamic secrets
const store = new DynamicCredentialStore({
  provisioner: 'vault-dynamic',
  vaultAddr:   process.env.VAULT_ADDR!,
  vaultToken:  process.env.VAULT_TOKEN!,
  roleName:    'agent-identity-db-role',
  ttl:         '1h',
});

// AWS IAM Roles Anywhere
const store = new DynamicCredentialStore({
  provisioner:     'aws-iam-roles-anywhere',
  profileArn:      'arn:aws:rolesanywhere:us-east-1:...',
  roleArn:         'arn:aws:iam::...:role/AgentIdentityRole',
  trustAnchorArn:  'arn:aws:rolesanywhere:us-east-1:...',
  certificatePath: '/run/spire/svid.pem',
  privateKeyPath:  '/run/spire/svid-key.pem',
});

// Azure Managed Identity
const store = new DynamicCredentialStore({
  provisioner: 'azure-managed-identity',
  resource:    'https://management.azure.com/',
  clientId:    process.env.AZURE_CLIENT_ID, // optional for user-assigned MI
});

const router = createRouterFromStore(store, rules, logger);
```

## How it works

1. On the first `findByRef(ref)` call for a slot, the provisioner mints a new secret (DB password, IAM session token, etc.) from the backend.
2. The minted credential is cached in-memory until 60 seconds before its TTL expires.
3. On expiry, the next `findByRef()` call provisions a fresh secret automatically.
4. A full store compromise reveals only the cached in-flight secrets — no long-lived secrets exist anywhere.

## TTL considerations

| Provisioner | Typical TTL | Backend revocation |
|-------------|-------------|--------------------|
| Vault dynamic secrets | 1 h (configurable) | Vault lease revocation API |
| AWS IAM Roles Anywhere | 1 h (max 12 h) | IAM session revocation |
| Azure Managed Identity | 24 h | Azure AD token revocation |

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
