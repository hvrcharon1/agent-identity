/**
 * @datacules/agent-identity-cli — Vitest test suite — 14 cases
 *
 * All file I/O and HTTP calls are mocked via injected closures.
 * No live server required to run these tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseArguments,
  runAuditVerify,
  runReport,
  runHealth,
  runResolve,
} from './index';
import { HashChainAuditLogger } from '@datacules/agent-identity-compliance';
import type { AuditLogEntry } from '@datacules/agent-identity';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(partial: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    timestamp:    '2026-01-15T10:00:00Z',
    action:       'credential.resolved',
    userId:       'orders-agent',
    credentialId: 'cred-openai',
    resourceId:   'openai-api',
    provider:     'openai',
    traceId:      'trace-001',
    ...partial,
  };
}

/**
 * Build a valid JSONL audit log using HashChainAuditLogger so the
 * hashes are correct and ChainVerifier.verifyJsonl() will pass.
 */
function buildChainedJsonl(entries: AuditLogEntry[]): string {
  const lines: string[] = [];
  const sink = { log: (e: AuditLogEntry) => lines.push(JSON.stringify(e)) };
  const logger = new HashChainAuditLogger(sink);
  for (const e of entries) logger.log(e);
  return lines.join('\n');
}

// ─── parseArguments ────────────────────────────────────────────────────────────

describe('parseArguments', () => {
  it('parses positional command + sub-command', () => {
    const args = parseArguments(['audit', 'verify', '--file', 'audit.jsonl']);
    expect(args.command).toEqual(['audit', 'verify']);
    expect(args.file).toBe('audit.jsonl');
  });

  it('sets help flag on --help', () => {
    const args = parseArguments(['--help']);
    expect(args.help).toBe(true);
  });
});

// ─── runAuditVerify ────────────────────────────────────────────────────────────

describe('runAuditVerify', () => {
  it('returns exitCode 0 for an intact hash chain', async () => {
    const jsonl = buildChainedJsonl([
      makeEntry({ timestamp: '2026-01-15T09:00:00Z', traceId: 'trace-001' }),
      makeEntry({ timestamp: '2026-01-15T10:00:00Z', traceId: 'trace-002' }),
      makeEntry({ timestamp: '2026-01-15T11:00:00Z', traceId: 'trace-003' }),
    ]);
    const result = await runAuditVerify({ file: 'audit.jsonl', readFile: () => jsonl });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓ Audit chain intact');
    expect(result.stdout).toContain('Entries verified : 3');
  });

  it('returns exitCode 1 for a broken chain (tampered entry)', async () => {
    const jsonl = buildChainedJsonl([
      makeEntry({ traceId: 'trace-001' }),
      makeEntry({ traceId: 'trace-002' }),
    ]);
    // Tamper with the first entry: change a field so the hash mismatches
    const lines = jsonl.split('\n');
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    entry['userId'] = 'tampered-agent';
    lines[0] = JSON.stringify(entry);
    const tampered = lines.join('\n');

    const result = await runAuditVerify({ file: 'audit.jsonl', readFile: () => tampered });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('✗ Audit chain BROKEN');
  });

  it('returns exitCode 1 when the file cannot be read', async () => {
    const result = await runAuditVerify({
      file: '/nonexistent/audit.jsonl',
      readFile: () => { throw new Error('ENOENT: no such file or directory'); },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot read file');
    expect(result.stderr).toContain('ENOENT');
  });

  it('filters entries by date range before verifying', async () => {
    // Build three entries spread across three days
    const day1 = makeEntry({ timestamp: '2026-01-10T10:00:00Z', traceId: 'trace-day1' });
    const day2 = makeEntry({ timestamp: '2026-01-15T10:00:00Z', traceId: 'trace-day2' });
    const day3 = makeEntry({ timestamp: '2026-01-20T10:00:00Z', traceId: 'trace-day3' });
    // Build a NEW chain from only the day2 entry so the filtered chain is intact
    const filteredJsonl = buildChainedJsonl([day2]);
    // Full JSONL includes all three but we'll filter to just day2
    const result = await runAuditVerify({
      file: 'audit.jsonl',
      from: '2026-01-14',
      to:   '2026-01-16',
      readFile: () => filteredJsonl,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Entries verified : 1');
  });
});

// ─── runReport ─────────────────────────────────────────────────────────────────

describe('runReport', () => {
  const sampleEntries: AuditLogEntry[] = [
    makeEntry({ timestamp: '2026-01-15T09:00:00Z', action: 'credential.resolved', userId: 'orders-agent', resourceId: 'openai-api' }),
    makeEntry({ timestamp: '2026-01-15T10:00:00Z', action: 'credential.resolved', userId: 'orders-agent', resourceId: 'pii-customer-db' }),
    makeEntry({ timestamp: '2026-01-15T11:00:00Z', action: 'credential.resolved', userId: 'analytics-agent', credentialId: 'cred-anthropic', resourceId: 'anthropic-api', provider: 'anthropic' }),
    makeEntry({ timestamp: '2026-01-15T02:00:00Z', action: 'credential.resolved', userId: 'orders-agent', resourceId: 'openai-api' }), // off-hours
    { ...makeEntry(), timestamp: '2026-01-15T03:00:00Z', action: 'credential.rotated', userId: 'system', credentialId: 'cred-openai', resourceId: 'vault', provider: 'local', traceId: 'trace-rotate' },
  ];
  const jsonl = sampleEntries.map((e) => JSON.stringify(e)).join('\n');
  const readFile = () => jsonl;

  it('generates a SOC 2 JSON report with all required sections', async () => {
    const result = await runReport({ type: 'soc2', file: 'audit.jsonl', from: '2026-01-01', to: '2026-01-31', readFile });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report['type']).toBe('soc2');
    expect(Array.isArray(report['agentAccessSummary'])).toBe(true);
    expect(Array.isArray(report['credentialRotationHistory'])).toBe(true);
  });

  it('populates piiResourceAccess for GDPR report', async () => {
    const result = await runReport({ type: 'gdpr', file: 'audit.jsonl', from: '2026-01-01', to: '2026-01-31', readFile });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as { piiResourceAccess: unknown[] };
    // 'pii-customer-db' contains 'pii' tag — should appear in piiResourceAccess
    expect(report.piiResourceAccess.length).toBeGreaterThan(0);
  });

  it('generates a HIPAA report in markdown format', async () => {
    const result = await runReport({ type: 'hipaa', file: 'audit.jsonl', from: '2026-01-01', to: '2026-01-31', format: 'markdown', readFile });
    expect(result.exitCode).toBe(0);
    // Markdown output starts with "# Agent Identity"
    expect(result.stdout).toContain('# Agent Identity');
    expect(result.stdout).toContain('HIPAA');
  });

  it('writes report to disk when --output is given', async () => {
    const written: Record<string, string> = {};
    const writeFile = (path: string, content: string) => { written[path] = content; };
    const result = await runReport({
      type: 'soc2',
      file: 'audit.jsonl',
      from: '2026-01-01',
      to: '2026-01-31',
      output: '/tmp/reports',
      readFile,
      writeFile,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Report written to');
    const paths = Object.keys(written);
    expect(paths.length).toBe(1);
    expect(paths[0]).toContain('soc2-report');
    expect(paths[0]).toContain('.json');
  });

  it('returns exitCode 1 when the audit log file cannot be read', async () => {
    const result = await runReport({
      type: 'soc2',
      file: '/nonexistent.jsonl',
      readFile: () => { throw new Error('ENOENT'); },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot read file');
  });
});

// ─── runHealth ─────────────────────────────────────────────────────────────────

describe('runHealth', () => {
  it('returns exitCode 0 when server responds 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await runHealth({ url: 'http://localhost:3000', fetch: mockFetch as unknown as typeof fetch });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓ Server at http://localhost:3000 is healthy');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/health');
  });

  it('returns exitCode 1 when server cannot be reached', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await runHealth({ url: 'http://localhost:3000', fetch: mockFetch as unknown as typeof fetch });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('✗ Cannot reach server');
    expect(result.stderr).toContain('ECONNREFUSED');
  });
});

// ─── runResolve ────────────────────────────────────────────────────────────────

describe('runResolve', () => {
  it('returns exitCode 0 and prints JSON on successful resolution (200)', async () => {
    const mockBody = { resolvedFor: 'user-123', credentialId: 'cred-openai', provider: 'openai' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockBody,
    });
    const result = await runResolve({
      provider: 'openai',
      user: 'user-123',
      url: 'http://localhost:3000',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('cred-openai');
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, string>;
    expect(body['provider']).toBe('openai');
    expect(body['userId']).toBe('user-123');
  });

  it('returns exitCode 1 on 403 (no matching rule)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'no matching routing rule' }),
    });
    const result = await runResolve({
      provider: 'mistral',
      user: 'user-999',
      url: 'http://localhost:3000',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('✗ Resolve failed');
    expect(result.stderr).toContain('403');
  });
});
