/**
 * AWS Secrets Manager + DynamoDB CredentialStore implementation.
 *
 * Secrets Manager holds the credential metadata JSON (id, kind, scope, status, ref).
 * DynamoDB holds migration reservation locks (TTL-based, atomic conditional writes).
 *
 * Setup:
 *   1. Store each Credential as a JSON string in Secrets Manager.
 *      Tag it with  agent-identity-status: active|pending|revoked
 *      so listActive() can filter via the tag API.
 *   2. Create a DynamoDB table named 'agent-identity-locks' with
 *      partition key 'ref' (String) and TTL attribute 'expiresAt' (Number).
 *   3. Grant the IAM role: secretsmanager:GetSecretValue,
 *      secretsmanager:ListSecrets, dynamodb:PutItem, dynamodb:DeleteItem.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { Credential, CredentialKind, CredentialStore } from '@datacules/agent-identity';

export interface AwsCredentialStoreOptions {
  /** AWS region (default: reads AWS_REGION env var) */
  region?: string;
  /** DynamoDB table name for migration locks (default: 'agent-identity-locks') */
  locksTable?: string;
}

export class AwsCredentialStore implements CredentialStore {
  private readonly sm: SecretsManagerClient;
  private readonly dynamo: DynamoDBClient;
  private readonly locksTable: string;

  constructor(options: AwsCredentialStoreOptions = {}) {
    const config = options.region ? { region: options.region } : {};
    this.sm = new SecretsManagerClient(config);
    this.dynamo = new DynamoDBClient(config);
    this.locksTable = options.locksTable ?? 'agent-identity-locks';
  }

  async findByRef(ref: string): Promise<Credential | null> {
    try {
      const res = await this.sm.send(new GetSecretValueCommand({ SecretId: ref }));
      if (!res.SecretString) return null;
      const cred: Credential = JSON.parse(res.SecretString);
      return cred.status === 'active' ? cred : null;
    } catch {
      return null;
    }
  }

  async listActive(): Promise<Credential[]> {
    const res = await this.sm.send(
      new ListSecretsCommand({
        Filters: [{ Key: 'tag-key', Values: ['agent-identity-status'] }],
      })
    );
    const results: Credential[] = [];
    for (const s of res.SecretList ?? []) {
      const tag = s.Tags?.find((t) => t.Key === 'agent-identity-status');
      if (tag?.Value !== 'active') continue;
      try {
        const cred: Credential = JSON.parse(s.Description ?? '{}');
        results.push(cred);
      } catch {
        // malformed description — skip
      }
    }
    return results;
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const all = await this.listActive();
    return all.filter((c) => c.kind === kind);
  }

  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    try {
      await this.dynamo.send(
        new PutItemCommand({
          TableName: this.locksTable,
          Item: {
            ref: { S: ref },
            migrationId: { S: migrationId },
            expiresAt: { N: String(expiresAt) },
          },
          // Succeed only if: no item exists, OR this migration already owns it, OR the TTL has expired
          ConditionExpression:
            'attribute_not_exists(#r) OR migrationId = :mid OR expiresAt < :now',
          ExpressionAttributeNames: { '#r': 'ref' },
          ExpressionAttributeValues: {
            ':mid': { S: migrationId },
            ':now': { N: String(Math.floor(Date.now() / 1000)) },
          },
        })
      );
      return true;
    } catch {
      return false; // ConditionalCheckFailedException — already locked
    }
  }

  async release(ref: string, migrationId: string): Promise<void> {
    try {
      await this.dynamo.send(
        new DeleteItemCommand({
          TableName: this.locksTable,
          Key: { ref: { S: ref } },
          ConditionExpression: 'migrationId = :mid',
          ExpressionAttributeValues: { ':mid': { S: migrationId } },
        })
      );
    } catch {
      // Idempotent — already released or never held
    }
  }
}
