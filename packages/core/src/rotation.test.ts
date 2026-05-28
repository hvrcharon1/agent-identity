/**
 * rotation.test.ts
 *
 * Tests for CredentialRotationScheduler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialRotationScheduler } from './rotation';
import type { Credential, AuditLogEntry, AuditLogger, RotationPolicy } from './types';
import type { RotationRepository, RotationProvider } from './rotation';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-openai',
    kind: 'fixed',
    name: 'OpenAI',
    scope: 'read:write',
    status: 'active',
    provider: 'openai',
    ref: 'openai-slot-v1',
    ...overrides,
  };
}

class MemoryRotationRepo implements RotationRepository {
  private readonly creds: Map<string, Credential>;
  readonly updates: Array<{ id: string; patch: Partial<Credential> }> = [];

  constructor(credentials: Credential[]) {
    this.creds = new Map(credentials.map((c) => [c.id, { ...c }]));
  }

  async listActive(): Promise<Credential[]> {
    return Array.from(this.creds.values()).filter((c) => c.status === 'active');
  }

  async update(id: string, patch: Partial<Credential>): Promise<void> {
    this.updates.push({ id, patch });
    const existing = this.creds.get(id);
    if (existing) this.creds.set(id, { ...existing, ...patch });
  }
}

class SpyAuditLogger implements AuditLogger {
  readonly entries: AuditLogEntry[] = [];
  log(entry: AuditLogEntry): void { this.entries.push(entry); }
}

// ─── CredentialRotationScheduler ─────────────────────────────────────────────

describe('CredentialRotationScheduler', () => {
  let logger: SpyAuditLogger;

  beforeEach(() => {
    logger = new SpyAuditLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no credentials have a rotation policy', async () => {
    const repo = new MemoryRotationRepo([makeCredential()]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    await scheduler.runOnce();
    expect(repo.updates).toHaveLength(0);
    expect(logger.entries).toHaveLength(0);
  });

  it('skips rotation when rotateAfterDays has not elapsed', async () => {
    const cred = makeCredential({
      lastRotated: new Date().toISOString(), // just rotated
      rotation: { rotateAfterDays: 30, provisioner: 'vault' } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    await scheduler.runOnce();
    expect(repo.updates).toHaveLength(0);
  });

  it('rotates when rotateAfterDays has elapsed', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const cred = makeCredential({
      lastRotated: thirtyOneDaysAgo,
      rotation: { rotateAfterDays: 30, provisioner: 'test-provider' } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);

    const mockProvider: RotationProvider = {
      id: 'test-provider',
      rotate: vi.fn().mockResolvedValue({ newRef: 'openai-slot-v2', rotatedAt: new Date().toISOString() }),
    };
    scheduler.registerProvider(mockProvider);

    await scheduler.runOnce();

    expect(mockProvider.rotate).toHaveBeenCalledOnce();
    expect(repo.updates).toHaveLength(1);
    expect(repo.updates[0].patch.ref).toBe('openai-slot-v2');
  });

  it('emits credential.rotated audit event on successful rotation', async () => {
    const daysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const cred = makeCredential({
      lastRotated: daysAgo,
      rotation: { rotateAfterDays: 30, provisioner: 'vault' } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    scheduler.registerProvider({
      id: 'vault',
      rotate: vi.fn().mockResolvedValue({ newRef: 'new-slot', rotatedAt: new Date().toISOString() }),
    });

    await scheduler.runOnce();

    const event = logger.entries.find((e) => e.action === 'credential.rotated');
    expect(event).toBeDefined();
    expect(event?.credentialId).toBe(cred.id);
  });

  it('emits credential.rotation_failed when provider throws', async () => {
    const daysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const cred = makeCredential({
      lastRotated: daysAgo,
      rotation: { rotateAfterDays: 30, provisioner: 'failing-provider' } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    scheduler.registerProvider({
      id: 'failing-provider',
      rotate: vi.fn().mockRejectedValue(new Error('Vault unreachable')),
    });

    await scheduler.runOnce();

    const event = logger.entries.find((e) => e.action === 'credential.rotation_failed');
    expect(event).toBeDefined();
    // Credential ref should be unchanged
    expect(repo.updates).toHaveLength(0);
  });

  it('emits credential.rotation_due warning when within notifyBeforeDays window', async () => {
    // 29 days since last rotation, due at 30 days, notify 3 days before
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 86_400_000).toISOString();
    const cred = makeCredential({
      lastRotated: twentyNineDaysAgo,
      rotation: {
        rotateAfterDays: 30,
        notifyBeforeDays: 3,
        provisioner: 'vault',
      } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    // No provider registered — rotation won't execute (not due yet at exactly 29 days)
    await scheduler.runOnce();

    const warning = logger.entries.find((e) => e.action === 'credential.rotation_due');
    expect(warning).toBeDefined();
  });

  it('warns when no provider matches the provisioner key', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const daysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const cred = makeCredential({
      lastRotated: daysAgo,
      rotation: { rotateAfterDays: 30, provisioner: 'missing-provider' } as RotationPolicy,
    });
    const repo = new MemoryRotationRepo([cred]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    await scheduler.runOnce();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('start() triggers runOnce on the interval and stop() clears it', async () => {
    const repo = new MemoryRotationRepo([]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    const runOnceSpy = vi.spyOn(scheduler, 'runOnce').mockResolvedValue();

    scheduler.start(1000);
    vi.advanceTimersByTime(3000);
    scheduler.stop();

    // Should have been called ~3 times during the 3000ms window
    expect(runOnceSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    const callsBefore = runOnceSpy.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(runOnceSpy.mock.calls.length).toBe(callsBefore); // stopped — no new calls
  });

  it('stop() before start() does not throw', () => {
    const repo = new MemoryRotationRepo([]);
    const scheduler = new CredentialRotationScheduler(repo, logger);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
