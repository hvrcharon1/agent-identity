<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-aws`

AWS Secrets Manager + DynamoDB credential store for the agent-identity framework. Drop-in replacement for `MemoryCredentialStore`.

## Install

```bash
npm install @datacules/agent-identity-store-aws
```

Requires AWS SDK v3 (`@aws-sdk/client-secrets-manager`, `@aws-sdk/client-dynamodb`) as peer dependencies.

## Usage

```typescript
import { AwsCredentialStore }  from '@datacules/agent-identity-store-aws';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new AwsCredentialStore({
  region: 'us-east-1',
  // Optional: DynamoDB table for reservation locks (prevents concurrent migration corruption)
  dynamoTableName: 'agent-identity-locks',
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
```

## What it does

- **`findByRef(ref)`** — calls `GetSecretValue` on Secrets Manager for the given ref.
- **`reserve(ref, migrationId, ttlSeconds)`** — puts a conditional item in DynamoDB to lock the credential for one migration run.
- **`release(ref, migrationId)`** — deletes the DynamoDB lock item.
- **`listActive()` / `listByKind()`** — reads the credential index from Secrets Manager.

Credential secrets are fetched lazily on `resolve()` — they are never cached in memory beyond the current request.

## IAM permissions required

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:ListSecrets"
  ],
  "Resource": "arn:aws:secretsmanager:*:*:secret:agent-identity/*"
}
```

For reservation locks, also grant `dynamodb:PutItem`, `dynamodb:DeleteItem`, `dynamodb:GetItem` on the locks table.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
