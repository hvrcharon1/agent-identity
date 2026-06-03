<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-azure`

Azure Key Vault + Azure Table Storage credential store for the agent-identity framework. Drop-in replacement for `MemoryCredentialStore`.

## Install

```bash
npm install @datacules/agent-identity-store-azure
```

Requires `@azure/keyvault-secrets` and `@azure/data-tables` as peer dependencies.

## Usage

```typescript
import { AzureKeyVaultCredentialStore } from '@datacules/agent-identity-store-azure';
import { createRouterFromStore }        from '@datacules/agent-identity';

const store = new AzureKeyVaultCredentialStore({
  keyVaultUrl:    'https://my-vault.vault.azure.net',
  tablesEndpoint: 'https://myaccount.table.core.windows.net',
  // Credentials resolved from DefaultAzureCredential (Managed Identity, env vars, CLI)
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```

## What it does

- **`findByRef(ref)`** — calls `getSecret(ref)` on Azure Key Vault.
- **`reserve(ref, migrationId, ttlSeconds)`** — inserts a row in Azure Table Storage to lock the credential for one migration run.
- **`release(ref, migrationId)`** — deletes the Table Storage row.
- **`listActive()` / `listByKind()`** — lists secrets from Key Vault with the `agent-identity` tag.

## Authentication

Uses `DefaultAzureCredential` from `@azure/identity`, which supports Managed Identity, Workload Identity, environment variables, and Azure CLI in order. No client secret needed when running in Azure.

```bash
# Local dev with Azure CLI
az login
```

## Required RBAC roles

| Resource | Role |
|----------|------|
| Key Vault | `Key Vault Secrets User` (read) |
| Table Storage | `Storage Table Data Contributor` |

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
