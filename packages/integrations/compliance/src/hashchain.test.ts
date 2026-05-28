/**
 * hashchain.test.ts
 *
 * Tests for HashChainAuditLogger and ChainVerifier.
 * Uses Node.js crypto (available in Vitest / Node 18+).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HashChainAuditLogger,
  ChainVerifier,
} from './index';
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';
import type { ChainedAuditLogEntry } from './index';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    traceId: `trace-${Math.random().toString(36).slice(2)}`,
    userId: 'user-alice',
    action: 'read',
    resourceId: 'knowledge-base',
    resourceKind: 'personal',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    credentialId: 'cred-anthropic',
    credentialKind: 'fixed',
    resolvedFor: 'user-alice',
    ...overrides,
  };
}

class CollectingLogger implements AuditLogger {
  readonly received: AuditLogEntry[] = [];
  log(entry: AuditLogEntry): void { this.received.push(entry); }
}

// ─── HashChainAuditLogger ─────────────────────────────────────────────────────

describe('HashChainAuditLogger', () => {
  let sink: CollectingLogger;
  let logger: HashChainAuditLogger;

  beforeEach(() => {
    sink = new CollectingLogger();
    logger = new HashChainAuditLogger(sink);
  });

  it('forwards entries to the underlying sink', () => {
    logger.log(makeEntry());
    expect(sink.received).toHaveLength(1);
  });

  it('first entry has prevHash === empty string', () => {
    logger.log(makeEntry());
    const entry = sink.received[0] as ChainedAuditLogEntry;
    expect(entry.prevHash).toBe('');
  });

  it('second entry prevHash === first entry hash', () => {
    logger.log(makeEntry({ action: 'read' }));
    logger.log(makeEntry({ action: 'write' }));
    const [first, second] = sink.received as ChainedAuditLogEntry[];
    expect(second.prevHash).toBe(first.hash);
  });

  it('all entries have a non-empty hash field', () => {
    for (let i = 0; i < 5; i++) logger.log(makeEntry());
    for (const entry of sink.received as ChainedAuditLogEntry[]) {
      expect(entry.hash).toBeTruthy();
      expect(entry.hash.length).toBeGreaterThan(0);
    }
  });

  it('currentHash matches the last entry hash', () => {
    logger.log(makeEntry());
    logger.log(makeEntry());
    const last = sink.received[sink.received.length - 1] as ChainedAuditLogEntry;
    expect(logger.currentHash).toBe(last.hash);
  });

  it('each entry has a unique hash', () => {
    for (let i = 0; i < 5; i++) logger.log(makeEntry({ userId: `user-${i}` }));
    const hashes = (sink.received as ChainedAuditLogEntry[]).map((e) => e.hash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });
});

// ─── ChainVerifier ────────────────────────────────────────────────────────────

describe('ChainVerifier', () => {
  function buildChain(count: number): ChainedAuditLogEntry[] {
    const sink = new CollectingLogger();
    const chainLogger = new HashChainAuditLogger(sink);
    for (let i = 0; i < count; i++) chainLogger.log(makeEntry({ userId: `user-${i}` }));
    return sink.received as ChainedAuditLogEntry[];
  }

  it('returns intact=true for a correctly formed chain', () => {
    const chain = buildChain(5);
    const result = ChainVerifier.verify(chain);
    expect(result.intact).toBe(true);
    expect(result.entryCount).toBe(5);
    expect(result.brokenAt).toBeNull();
    expect(result.brokenReason).toBeNull();
    expect(result.rootHash).toBe(chain[4].hash);
  });

  it('returns intact=true for a single-entry chain', () => {
    const chain = buildChain(1);
    const result = ChainVerifier.verify(chain);
    expect(result.intact).toBe(true);
    expect(result.entryCount).toBe(1);
  });

  it('returns intact=false for an empty array', () => {
    const result = ChainVerifier.verify([]);
    expect(result.intact).toBe(false);
    expect(result.entryCount).toBe(0);
    expect(result.brokenReason).toBeDefined();
  });

  it('detects tampering: modified field breaks the chain', () => {
    const chain = buildChain(4);
    // Tamper with entry at index 2
    chain[2] = { ...chain[2], userId: 'evil-intruder' };
    const result = ChainVerifier.verify(chain);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects tampering: modified hash field breaks the chain', () => {
    const chain = buildChain(4);
    chain[1] = { ...chain[1], hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    const result = ChainVerifier.verify(chain);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).not.toBeNull();
  });

  it('verifyJsonl() parses JSONL and verifies the chain', () => {
    const chain = buildChain(3);
    const jsonl = chain.map((e) => JSON.stringify(e)).join('\n');
    const result = ChainVerifier.verifyJsonl(jsonl);
    expect(result.intact).toBe(true);
    expect(result.entryCount).toBe(3);
  });

  it('verifyJsonl() handles blank lines gracefully', () => {
    const chain = buildChain(2);
    const jsonl = `${JSON.stringify(chain[0])}\n\n${JSON.stringify(chain[1])}\n`;
    const result = ChainVerifier.verifyJsonl(jsonl);
    expect(result.intact).toBe(true);
    expect(result.entryCount).toBe(2);
  });

  it('verifyJsonl() returns intact=false for a malformed JSON line', () => {
    const chain = buildChain(2);
    const jsonl = `${JSON.stringify(chain[0])}\nNOT_VALID_JSON`;
    const result = ChainVerifier.verifyJsonl(jsonl);
    expect(result.intact).toBe(false);
    expect(result.brokenReason).toContain('failed to parse as JSON');
  });

  it('rootHash is the hash of the last entry in an intact chain', () => {
    const chain = buildChain(5);
    const result = ChainVerifier.verify(chain);
    expect(result.rootHash).toBe(chain[chain.length - 1].hash);
  });
});
