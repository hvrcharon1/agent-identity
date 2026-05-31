/**
 * providers.test.ts — Vitest unit tests for assertMigrationScope logic
 * and injectCredential implementations in packages/core/src/providers.ts.
 *
 * 12 cases across three groups:
 *
 * Group 1 — validateForMigration with explicit scope field (authoritative path, 6 cases)
 *   The router populates ResolvedCredential.scope from Credential.scope.
 *   assertMigrationScope checks this field first, before any ref heuristics.
 *
 * Group 2 — validateForMigration with no scope field (ref heuristic fallback, 4 cases)
 *   When scope is absent, the legacy naming-convention check fires. Error messages
 *   include '(naming heuristic — set Credential.scope for authoritative enforcement)'
 *   so callers know to upgrade.
 *
 * Group 3 — injectCredential smoke (2 cases)
 *   Basic sanity that the two most-used adapters attach the expected fields.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAdapter } from './providers';
import type { ResolvedCredential } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResolved(ref: string, scope?: string): ResolvedCredential {
  return {
    credentialId: 'cred-test',
    kind: 'fixed',
    ref,
    resolvedFor: 'service',
    scope,
  };
}

// ─── Group 1: scope field (authoritative) ─────────────────────────────────────

describe('validateForMigration — scope field (authoritative)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when scope is "read-only" and phase is load', () => {
    const adapter = getAdapter('openai');
    const cred = makeResolved('some-slot', 'read-only');
    expect(() => adapter.validateForMigration!(cred, 'load')).toThrow(
      /phase "load" requires a write-scoped/
    );
  });

  it('throws when scope contains "Read-only replica" and phase is rollback (case-insensitive)', () => {
    const adapter = getAdapter('anthropic');
    const cred = makeResolved('some-slot', 'Read-only replica');
    expect(() => adapter.validateForMigration!(cred, 'rollback')).toThrow(
      /scope "Read-only replica" is read-only/
    );
  });

  it('does not throw when scope is "All projects - read/write" and phase is load', () => {
    const adapter = getAdapter('openai');
    const cred = makeResolved('prod-slot', 'All projects - read/write');
    expect(() => adapter.validateForMigration!(cred, 'load')).not.toThrow();
  });

  it('emits console.warn when scope contains "write" and phase is dry-run', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = getAdapter('openai');
    const cred = makeResolved('prod-slot', 'read/write');
    adapter.validateForMigration!(cred, 'dry-run');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dry-run')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('scope: "read/write"')
    );
  });

  it('does not throw when scope is "read-only" and phase is extract (read phases are fine)', () => {
    const adapter = getAdapter('gemini');
    const cred = makeResolved('source-slot', 'read-only');
    expect(() => adapter.validateForMigration!(cred, 'extract')).not.toThrow();
  });

  it('does not emit warning when scope is "readonly" and phase is dry-run', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = getAdapter('mistral');
    const cred = makeResolved('source-slot', 'readonly');
    adapter.validateForMigration!(cred, 'dry-run');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── Group 2: ref heuristic fallback (no scope field) ─────────────────────────

describe('validateForMigration — ref heuristic fallback (no scope field)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when ref contains "readonly" and phase is load, with heuristic note in error', () => {
    const adapter = getAdapter('openai');
    const cred = makeResolved('analytics-db-readonly-slot');
    expect(() => adapter.validateForMigration!(cred, 'load')).toThrow(
      /naming heuristic/
    );
  });

  it('throws when ref ends with "-ro" and phase is rollback', () => {
    const adapter = getAdapter('gemini');
    const cred = makeResolved('source-slot-ro');
    expect(() => adapter.validateForMigration!(cred, 'rollback')).toThrow(
      /appears read-only/
    );
  });

  it('emits console.warn when ref is generic and phase is dry-run, with upgrade hint', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = getAdapter('mistral');
    const cred = makeResolved('write-capable-slot');
    adapter.validateForMigration!(cred, 'dry-run');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Set Credential.scope for explicit enforcement')
    );
  });

  it('does not throw when ref contains "readonly" and phase is extract', () => {
    const adapter = getAdapter('anthropic');
    const cred = makeResolved('source-readonly-slot');
    expect(() => adapter.validateForMigration!(cred, 'extract')).not.toThrow();
  });
});

// ─── Group 3: injectCredential smoke ──────────────────────────────────────────

describe('injectCredential', () => {
  it('openai adapter attaches user field and _agentIdentityMeta', () => {
    const adapter = getAdapter('openai');
    const cred = makeResolved('openai-slot');
    const result = adapter.injectCredential({ model: 'gpt-4o' }, cred);
    expect(result).toHaveProperty('user', 'service');
    expect(result).toHaveProperty('_agentIdentityMeta');
    const meta = result._agentIdentityMeta as Record<string, unknown>;
    expect(meta.credentialRef).toBe('openai-slot');
  });

  it('anthropic adapter attaches metadata.user_id with resolvedFor value', () => {
    const adapter = getAdapter('anthropic');
    const cred: ResolvedCredential = { ...makeResolved('anthropic-slot'), resolvedFor: 'user-abc' };
    const result = adapter.injectCredential({ model: 'claude-3-5-sonnet' }, cred);
    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata?.user_id).toBe('user-abc');
  });
});
