/**
 * AwsCredentialStore — implements CredentialStore using:
 *   - AWS Secrets Manager for credential storage and retrieval
 *   - DynamoDB for distributed reservation locking (prevents concurrent migration
 *     jobs from sharing a write credential and corrupting the target)
 *
 * IAM permissions required:
 *   secretsmanager:GetSecretValue
 *   secretsmanager:ListSecrets (for listActive / listByKind)
 *   dynamodb:PutItem, dynamodb:DeleteItem, dynamodb:GetItem (for reserve / release)
 *
 * DynamoDB table schema (create once):
 *   Table name : agent-identity-locks  (override via constructor)
 *   Partition key: ref (String)
 *   TTL attribute : expiresAt (Number — epoch seconds)
 *
 * Usage:
 *   import { AwsCredentialStore } from '@datacules/agent-identity-store-aws';
 *   import { createRouterFromStore } from '@datacules/agent-identity';
 *
 *   const store  = new AwsCredentialStore();
 *   const router = createRouterFromStore(store, myRules, myLogger);
 *   const cred   = await router.resolveAsync(ctx);
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
  /** AWS region; falls back to AWS_REGION env var */
  region?: string;
  /** DynamoDB table used for reservation locks. Default: 'agent-identity-locks' */
  locksTableName?: string;
  /**
   * Tag key used to filter credentials in Secrets Manager.
   * Only secrets tagged with this key will be returned by listActive().
   * Default: 'agent-identity-status'
   */
  tagKey?: string;
}

export class AwsCredentialStore implements CredentialStore {
  private readonly sm: SecretsManagerClient;
  private readonly dynamo: DynamoDBClient;
  private readonly locksTable: string;
  private readonly tagKey: string;

  constructor(options: AwsCredentialStoreOptions = {}) {
    const clientConfig = options.region ? { region: options.region } : {};
    this.sm           = new SecretsManagerClient(clientConfig);
    this.dynamo       = new DynamoDBClient(clientConfig);
    this.locksTable   = options.locksTableName ?? 'agent-identity-locks';
    this.tagKey       = options.tagKey ?? 'agent-identity-status';
  }

  // ─── CredentialStore interface ────────────────────────────────────────

  async findByRef(ref: string): Promise<Credential | null> {
    try {
      const res = await this.sm.send(
        new GetSecretValueCommand({ SecretId: ref })
      );
      if (!res.SecretString) return null;
      return JSON.parse(res.SecretString) as Credential;
    } catch (err: unknown) {
      // ResourceNotFoundException → credential not found; rethrow anything else
      if (
        err instanceof Error &&
        (err.name === 'ResourceNotFoundException' || err.name === 'NoSuchKey')
      ) {
        return null;
      }
      throw err;
    }
  }

  async listActive(): Promise<Credential[]> {
    const res = await this.sm.send(
      new ListSecretsCommand({
        Filters: [{ Key: 'tag-key', Values: [this.tagKey] }],
      })
    );

    const secrets = res.SecretList ?? [];
    const credentials = await Promise.all(
      secrets.map((s) => (s.Name ? this.findByRef(s.Name) : null))
    );

    return credentials.filter((c): c is Credential => c !== null && c.status === 'active');
  }

  async listByKind(kind: CredentialKind): Promise<Credential[]> {
    const all = await this.listActive();
    return all.filter((c) => c.kind === kind);
  }

  /**
   * Atomically reserve `ref` for `migrationId` using a DynamoDB conditional write.
   * Returns false if the credential is already held by a different migration.
   * DynamoDB TTL on `expiresAt` handles expired locks automatically (lag ≤24h is fine
   * because we also check the timestamp in the condition expression).
   */
  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    try {
      await this.dynamo.send(
        new PutItemCommand({
          TableName: this.locksTable,
          Item: {
            ref:         { S: ref },
            migrationId: { S: migrationId },
            expiresAt:   { N: String(expiresAt) },
          },
          // Allow re-lock by the SAME migration or when the existing lock has expired
          ConditionExpression:
            'attribute_not_exists(#ref) OR expiresAt < :now OR migrationId = :mid',
          ExpressionAttributeNames: { '#ref': 'ref' },
          ExpressionAttributeValues: {
            ':now': { N: String(Math.floor(Date.now() / 1000)) },
            ':mid': { S: migrationId },
          },
        })
      );
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        return false; // held by another active migration
      }
      throw err;
    }
  }

  /**
   * Release a reservation. Should be called in the `finally` block of a migration run.
   * Silently ignores the case where the lock no longer exists (e.g. expired + cleaned up).
   */
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
    } catch (err: unknown) {
      // Ignore if lock doesn't exist or belongs to another migration
      if (
        err instanceof Error &&
        (err.name === 'ConditionalCheckFailedException' ||
          err.name === 'ResourceNotFoundException')
      ) {
        return;
      }
      throw err;
    }
  }
}
