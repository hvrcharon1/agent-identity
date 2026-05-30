import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConsoleAuditLogger,
  WebhookAuditLogger,
  DatadogAuditLogger,
  SplunkAuditLogger,
  CompositeAuditLogger,
} from './index';
import type { AuditLogEntry } from '@datacules/agent-identity';

// All HTTP calls are mocked via vi.stubGlobal('fetch', ...).
// No live webhook, Datadog, or Splunk endpoint is needed.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ENTRY: AuditLogEntry = {
  userId: 'user-alice',
  resourceId: 'knowledge-base',
  resourceKind: 'shared',
  provider: 'openai',
  action: 'read',
  credentialId: 'cred-openai-prod',
  credentialKind: 'fixed',
  resolvedFor: 'service',
  traceId: 'trace-abc123',
  sessionId: 'sess-xyz',
  requestedAt: '2026-05-30T12:00:00.000Z',
  model: 'gpt-4o',
};

// ── ConsoleAuditLogger ─────────────────────────────────────────────────────

describe('ConsoleAuditLogger', () => {
  it('calls console.log with the [agent-identity audit] prefix and JSON entry', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new ConsoleAuditLogger();
    await logger.log(ENTRY);
    expect(spy).toHaveBeenCalledOnce();
    const [prefix, json] = spy.mock.calls[0] as [string, string];
    expect(prefix).toBe('[agent-identity audit]');
    expect(json).toContain('cred-openai-prod');
    spy.mockRestore();
  });

  it('resolves without throwing on any valid AuditLogEntry', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new ConsoleAuditLogger();
    await expect(logger.log(ENTRY)).resolves.not.toThrow();
    vi.restoreAllMocks();
  });
});

// ── WebhookAuditLogger ─────────────────────────────────────────────────────

describe('WebhookAuditLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the entry as JSON to the configured webhook URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new WebhookAuditLogger({ url: 'https://hooks.example.com/agent-identity' });
    await logger.log(ENTRY);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.example.com/agent-identity',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: expect.stringContaining('cred-openai-prod'),
      })
    );
  });

  it('adds the X-Webhook-Secret header when a secret is configured', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new WebhookAuditLogger({
      url: 'https://hooks.example.com/ai',
      secret: 'hmac-secret-xyz',
    });
    await logger.log(ENTRY);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Webhook-Secret': 'hmac-secret-xyz' }),
      })
    );
  });

  it('resolves without throwing when fetch fails and silent=true (default)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new WebhookAuditLogger({ url: 'https://hooks.example.com/agent-identity' });
    await expect(logger.log(ENTRY)).resolves.not.toThrow();
    vi.restoreAllMocks();
  });

  it('throws when fetch fails and silent=false', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const logger = new WebhookAuditLogger({
      url: 'https://hooks.example.com/ai',
      silent: false,
    });
    await expect(logger.log(ENTRY)).rejects.toThrow('Connection refused');
  });
});

// ── DatadogAuditLogger ─────────────────────────────────────────────────────

describe('DatadogAuditLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to the Datadog log intake URL with the DD-API-KEY header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new DatadogAuditLogger({ apiKey: 'dd-api-key-test-123' });
    await logger.log(ENTRY);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://http-intake.logs.datadoghq.com/api/v2/logs'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'DD-API-KEY': 'dd-api-key-test-123' }),
      })
    );
  });

  it('uses a custom Datadog site when the site option is specified', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new DatadogAuditLogger({ apiKey: 'key', site: 'datadoghq.eu' });
    await logger.log(ENTRY);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('datadoghq.eu');
  });

  it('is silent by default when fetch fails (resolves without throwing)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Datadog unreachable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new DatadogAuditLogger({ apiKey: 'key' });
    await expect(logger.log(ENTRY)).resolves.not.toThrow();
    vi.restoreAllMocks();
  });
});

// ── SplunkAuditLogger ─────────────────────────────────────────────────────

describe('SplunkAuditLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to the HEC URL with a Splunk token Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new SplunkAuditLogger({
      hecUrl: 'https://splunk.example.com:8088/services/collector',
      token: 'splunk-token-abc',
    });
    await logger.log(ENTRY);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://splunk.example.com:8088/services/collector',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Splunk splunk-token-abc' }),
      })
    );
  });

  it('includes the audit entry inside the Splunk event payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const logger = new SplunkAuditLogger({
      hecUrl: 'https://splunk.example.com/collector',
      token: 'tok',
    });
    await logger.log(ENTRY);
    const body = JSON.parse(
      (mockFetch.mock.calls[0][1] as RequestInit).body as string
    ) as { event: AuditLogEntry; sourcetype: string };
    expect(body.event).toMatchObject({ credentialId: 'cred-openai-prod' });
    expect(body.sourcetype).toBe('agent_identity');
  });

  it('is silent by default when fetch fails (resolves without throwing)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('HEC unreachable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new SplunkAuditLogger({
      hecUrl: 'https://splunk.example.com/collector',
      token: 'tok',
    });
    await expect(logger.log(ENTRY)).resolves.not.toThrow();
    vi.restoreAllMocks();
  });
});

// ── CompositeAuditLogger ───────────────────────────────────────────────────

describe('CompositeAuditLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards the entry to all registered loggers', async () => {
    const logA = { log: vi.fn<[AuditLogEntry], Promise<void>>().mockResolvedValue(undefined) };
    const logB = { log: vi.fn<[AuditLogEntry], Promise<void>>().mockResolvedValue(undefined) };
    const composite = new CompositeAuditLogger([logA, logB]);
    await composite.log(ENTRY);
    expect(logA.log).toHaveBeenCalledWith(ENTRY);
    expect(logB.log).toHaveBeenCalledWith(ENTRY);
  });

  it('continues via Promise.allSettled even when one logger rejects', async () => {
    const logA = { log: vi.fn<[AuditLogEntry], Promise<void>>().mockRejectedValue(new Error('Sink A failed')) };
    const logB = { log: vi.fn<[AuditLogEntry], Promise<void>>().mockResolvedValue(undefined) };
    const composite = new CompositeAuditLogger([logA, logB]);
    await expect(composite.log(ENTRY)).resolves.not.toThrow();
    expect(logB.log).toHaveBeenCalledWith(ENTRY);
  });

  it('works correctly with a single logger', async () => {
    const logA = { log: vi.fn<[AuditLogEntry], Promise<void>>().mockResolvedValue(undefined) };
    const composite = new CompositeAuditLogger([logA]);
    await composite.log(ENTRY);
    expect(logA.log).toHaveBeenCalledOnce();
  });
});
