/**
 * @datacules/agent-identity audit loggers
 *
 * Pre-built AuditLogger implementations. Pass any of these to createRouter()
 * or createRouterFromStore() as the third argument.
 *
 * Available sinks:
 *   ConsoleAuditLogger     — pretty-prints to stdout (dev / debugging)
 *   WebhookAuditLogger     — POST to any HTTP endpoint
 *   DatadogAuditLogger     — Datadog Logs HTTP intake
 *   SplunkAuditLogger      — Splunk HTTP Event Collector
 *   CompositeAuditLogger   — fan-out to multiple loggers simultaneously
 *
 * Example:
 *   import { createRouter } from '@datacules/agent-identity';
 *   import { DatadogAuditLogger } from '@datacules/agent-identity-audit';
 *
 *   const logger = new DatadogAuditLogger(process.env.DD_API_KEY!);
 *   const router = createRouter(credentials, rules, logger);
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

// ─── Console (development) ───────────────────────────────────────────────────────────

export class ConsoleAuditLogger implements AuditLogger {
  async log(entry: AuditLogEntry): Promise<void> {
    console.log('[agent-identity audit]', JSON.stringify(entry, null, 2));
  }
}

// ─── Webhook (generic HTTP sink) ────────────────────────────────────────────────────

export interface WebhookAuditLoggerOptions {
  /** Webhook endpoint that receives POST requests with AuditLogEntry JSON */
  url: string;
  /** Optional shared secret sent as X-Webhook-Secret header */
  secret?: string;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** If true, log errors to console rather than throwing (default: true) */
  silent?: boolean;
}

export class WebhookAuditLogger implements AuditLogger {
  private readonly options: Required<WebhookAuditLoggerOptions>;

  constructor(options: WebhookAuditLoggerOptions) {
    this.options = {
      secret: '',
      timeoutMs: 5000,
      silent: true,
      ...options,
    };
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const { url, secret, timeoutMs, silent } = this.options;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Webhook-Secret'] = secret;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(entry),
        signal: controller.signal,
      });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] WebhookAuditLogger failed:', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Datadog ────────────────────────────────────────────────────────────────────

export interface DatadogAuditLoggerOptions {
  apiKey: string;
  service?: string;
  /** Datadog site (default: 'datadoghq.com') */
  site?: string;
  silent?: boolean;
}

export class DatadogAuditLogger implements AuditLogger {
  private readonly options: Required<DatadogAuditLoggerOptions>;

  constructor(options: DatadogAuditLoggerOptions) {
    this.options = { service: 'agent-identity', site: 'datadoghq.com', silent: true, ...options };
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const { apiKey, service, site, silent } = this.options;
    try {
      await fetch(`https://http-intake.logs.${site}/api/v2/logs`, {
        method: 'POST',
        headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ddsource: 'agent-identity',
          service,
          ddtags: `provider:${entry.provider},action:${entry.action},credentialKind:${entry.credentialKind}`,
          message: JSON.stringify(entry),
        }),
      });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] DatadogAuditLogger failed:', err);
    }
  }
}

// ─── Splunk ──────────────────────────────────────────────────────────────────────

export interface SplunkAuditLoggerOptions {
  /** HEC endpoint e.g. https://splunk.example.com:8088/services/collector/event */
  hecUrl: string;
  token: string;
  sourcetype?: string;
  silent?: boolean;
}

export class SplunkAuditLogger implements AuditLogger {
  private readonly options: Required<SplunkAuditLoggerOptions>;

  constructor(options: SplunkAuditLoggerOptions) {
    this.options = { sourcetype: 'agent_identity', silent: true, ...options };
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const { hecUrl, token, sourcetype, silent } = this.options;
    try {
      await fetch(hecUrl, {
        method: 'POST',
        headers: { Authorization: `Splunk ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: entry, sourcetype }),
      });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] SplunkAuditLogger failed:', err);
    }
  }
}

// ─── Composite (fan-out) ────────────────────────────────────────────────────────────

/**
 * Fan-out to multiple loggers simultaneously.
 * Errors from individual loggers are caught and logged to console
 * (unless that logger has silent:false), so one failing sink doesn't
 * block the others.
 *
 * Example:
 *   const logger = new CompositeAuditLogger([
 *     new ConsoleAuditLogger(),
 *     new DatadogAuditLogger({ apiKey: process.env.DD_API_KEY! }),
 *   ]);
 */
export class CompositeAuditLogger implements AuditLogger {
  constructor(private readonly loggers: AuditLogger[]) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await Promise.allSettled(this.loggers.map((l) => l.log(entry)));
  }
}
