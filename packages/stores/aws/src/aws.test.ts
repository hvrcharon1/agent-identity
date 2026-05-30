import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AWS SDK modules — constructors return objects with vi.fn() send methods.
// vi.mock() calls are hoisted before imports by Vitest.
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({ send: vi.fn() })),
  GetSecretValueCommand: vi.fn((input: unknown) => input),
  ListSecretsCommand: vi.fn((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: vi.fn() })),
  PutItemCommand: vi.fn((input: unknown) => input),
  DeleteItemCommand: vi.fn((input: unknown) => input),
}));

import { AwsCredentialStore } from './index.js';
import type { Credential } from '@datacules/agent-identity';

const makeCred = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'cred-openai',
  kind: 'fixed',
  name: 'OpenAI API Key',
  scope: 'global',
  status: 'active',
  provider: 'openai',
  ref: 'openai-prod-slot',
  ...overrides,
});

describe('AwsCredentialStore', () => {
  let store: AwsCredentialStore;
  let smSend: ReturnType<typeof vi.fn>;
  let dynamoSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new AwsCredentialStore({ region: 'us-east-1', locksTable: 'test-locks' });
    // Access mock send functions injected by the mocked constructors
    smSend = (store as any).sm.send as ReturnType<typeof vi.fn>;
    dynamoSend = (store as any).dynamo.send as ReturnType<typeof vi.fn>;
  });

  // ─── findByRef() ────────────────────────────────────────────────────────────

  describe('findByRef()', () => {
    it('returns active credential when SM returns active SecretString', async () => {
      const cred = makeCred();
      smSend.mockResolvedValue({ SecretString: JSON.stringify(cred) });
      const result = await store.findByRef('openai-prod-slot');
      expect(result).toEqual(cred);
    });

    it('returns null when credential status is not active', async () => {
      const cred = makeCred({ status: 'pending' });
      smSend.mockResolvedValue({ SecretString: JSON.stringify(cred) });
      expect(await store.findByRef('openai-prod-slot')).toBeNull();
    });

    it('returns null when SecretString is absent on the SM response', async () => {
      smSend.mockResolvedValue({ SecretString: undefined });
      expect(await store.findByRef('openai-prod-slot')).toBeNull();
    });

    it('returns null without throwing when SM send throws', async () => {
      smSend.mockRejectedValue(new Error('ResourceNotFoundException'));
      expect(await store.findByRef('missing-ref')).toBeNull();
    });

    it('sends GetSecretValueCommand with the correct SecretId', async () => {
      const cred = makeCred();
      smSend.mockResolvedValue({ SecretString: JSON.stringify(cred) });
      await store.findByRef('my-secret-ref');
      expect(smSend).toHaveBeenCalledWith(
        expect.objectContaining({ SecretId: 'my-secret-ref' })
      );
    });
  });

  // ─── listActive() ───────────────────────────────────────────────────────────

  describe('listActive()', () => {
    it('returns credentials where tag value is active, parsed from Description', async () => {
      const cred = makeCred();
      smSend.mockResolvedValue({
        SecretList: [
          {
            Tags: [{ Key: 'agent-identity-status', Value: 'active' }],
            Description: JSON.stringify(cred),
          },
        ],
      });
      const results = await store.listActive();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(cred);
    });

    it('skips secrets where the agent-identity-status tag value is not active', async () => {
      smSend.mockResolvedValue({
        SecretList: [
          {
            Tags: [{ Key: 'agent-identity-status', Value: 'revoked' }],
            Description: JSON.stringify(makeCred({ status: 'revoked' })),
          },
        ],
      });
      expect(await store.listActive()).toHaveLength(0);
    });

    it('returns empty array when SecretList is undefined', async () => {
      smSend.mockResolvedValue({ SecretList: undefined });
      expect(await store.listActive()).toEqual([]);
    });

    it('skips secrets with malformed Description JSON without throwing', async () => {
      smSend.mockResolvedValue({
        SecretList: [
          {
            Tags: [{ Key: 'agent-identity-status', Value: 'active' }],
            Description: 'not-valid-json',
          },
        ],
      });
      expect(await store.listActive()).toHaveLength(0);
    });
  });

  // ─── listByKind() ───────────────────────────────────────────────────────────

  describe('listByKind()', () => {
    it('returns only credentials matching the requested kind', async () => {
      const fixed = makeCred({ kind: 'fixed', id: 'cred-fixed' });
      const delegated = makeCred({ kind: 'user-delegated', id: 'cred-user', ref: 'user-slot' });
      smSend.mockResolvedValue({
        SecretList: [
          { Tags: [{ Key: 'agent-identity-status', Value: 'active' }], Description: JSON.stringify(fixed) },
          { Tags: [{ Key: 'agent-identity-status', Value: 'active' }], Description: JSON.stringify(delegated) },
        ],
      });
      const result = await store.listByKind('fixed');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('fixed');
    });

    it('returns empty array when no credentials match the requested kind', async () => {
      const fixed = makeCred({ kind: 'fixed' });
      smSend.mockResolvedValue({
        SecretList: [
          { Tags: [{ Key: 'agent-identity-status', Value: 'active' }], Description: JSON.stringify(fixed) },
        ],
      });
      expect(await store.listByKind('user-delegated')).toHaveLength(0);
    });
  });

  // ─── reserve() ──────────────────────────────────────────────────────────────

  describe('reserve()', () => {
    it('returns true when DynamoDB PutItem succeeds (no conflicting lock)', async () => {
      dynamoSend.mockResolvedValue({});
      expect(await store.reserve('cred-ref', 'migration-1', 300)).toBe(true);
    });

    it('returns false when DynamoDB throws ConditionalCheckFailedException', async () => {
      dynamoSend.mockRejectedValue(new Error('ConditionalCheckFailedException'));
      expect(await store.reserve('cred-ref', 'migration-2', 300)).toBe(false);
    });

    it('sends PutItemCommand to the configured locksTable name', async () => {
      dynamoSend.mockResolvedValue({});
      await store.reserve('my-ref', 'mig-id', 600);
      expect(dynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'test-locks' })
      );
    });
  });

  // ─── release() ──────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('issues a DeleteItemCommand with the correct ref key', async () => {
      dynamoSend.mockResolvedValue({});
      await store.release('cred-ref', 'migration-1');
      expect(dynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { ref: { S: 'cred-ref' } },
        })
      );
    });

    it('resolves without throwing when DeleteItem throws (idempotent release)', async () => {
      dynamoSend.mockRejectedValue(new Error('ConditionalCheckFailedException'));
      await expect(store.release('cred-ref', 'migration-x')).resolves.toBeUndefined();
    });
  });
});
