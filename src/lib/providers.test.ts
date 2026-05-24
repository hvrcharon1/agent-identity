/**
 * Unit tests for provider adapters (Finding #3).
 * Verifies each adapter produces the correct fields for its target provider.
 */
import { describe, it, expect } from 'vitest';
import { getAdapter } from './providers';
import type { ResolvedCredential } from './types';

const MOCK_CREDENTIAL: ResolvedCredential = {
  credentialId: 'cred-1',
  kind: 'fixed',
  ref: 'test-ref',
  resolvedFor: 'user-alice',
};

describe('Provider adapters — injectCredential', () => {
  it('openai adapter sets user field to resolvedFor', () => {
    const adapter = getAdapter('openai');
    const result = adapter.injectCredential({ model: 'gpt-4o' }, MOCK_CREDENTIAL);
    expect(result.user).toBe('user-alice');
  });

  it('anthropic adapter sets metadata.user_id to resolvedFor', () => {
    const adapter = getAdapter('anthropic');
    const result = adapter.injectCredential({ model: 'claude-sonnet-4-20250514' }, MOCK_CREDENTIAL);
    expect((result.metadata as Record<string, unknown>)?.user_id).toBe('user-alice');
  });

  it('gemini adapter sets labels.user_id to resolvedFor', () => {
    const adapter = getAdapter('gemini');
    const result = adapter.injectCredential({ contents: [] }, MOCK_CREDENTIAL);
    expect((result.labels as Record<string, unknown>)?.user_id).toBe('user-alice');
  });

  it('mistral adapter includes _agentIdentityMeta', () => {
    const adapter = getAdapter('mistral');
    const result = adapter.injectCredential({ model: 'mistral-large' }, MOCK_CREDENTIAL);
    expect(result._agentIdentityMeta).toBeDefined();
  });

  it('local adapter includes _agentIdentityMeta', () => {
    const adapter = getAdapter('local');
    const result = adapter.injectCredential({}, MOCK_CREDENTIAL);
    expect(result._agentIdentityMeta).toBeDefined();
  });
});

describe('Provider adapters — validate', () => {
  it('openai validate throws when model is missing', () => {
    const adapter = getAdapter('openai');
    expect(() => adapter.validate?.({})).toThrow('[openai] request.model is required');
  });

  it('anthropic validate throws when messages is missing', () => {
    const adapter = getAdapter('anthropic');
    expect(() => adapter.validate?.({ model: 'claude-sonnet-4-20250514' })).toThrow('[anthropic] request.messages is required');
  });

  it('gemini validate throws when contents is missing', () => {
    const adapter = getAdapter('gemini');
    expect(() => adapter.validate?.({})).toThrow('[gemini] request.contents is required');
  });
});
