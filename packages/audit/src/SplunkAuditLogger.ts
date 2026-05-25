/**
 * SplunkAuditLogger — ships AuditLogEntry objects to Splunk HTTP Event Collector (HEC).
 *
 * Docs: https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector
 *
 * Usage:
 *   import { SplunkAuditLogger } from '@datacules/agent-identity-audit';
 *   const logger = new SplunkAuditLogger(
 *     'https://splunk.example.com:8088/services/collector/event',
 *     process.env.SPLUNK_HEC_TOKEN!
 *   );
 *   const router = createRouter(credentials, rules, logger);
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

export class SplunkAuditLogger implements AuditLogger {
  constructor(
    private readonly hecUrl: string,
    private readonly token: string,
    private readonly index?: string,
    private readonly host?: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const payload: Record<string, unknown> = {
      time:       new Date(entry.timestamp).getTime() / 1000, // epoch seconds
      event:      entry,
      sourcetype: 'agent_identity',
    };
    if (this.index) payload.index = this.index;
    if (this.host)  payload.host  = this.host;

    const res = await this.fetchFn(this.hecUrl, {
      method: 'POST',
      headers: {
        Authorization:  `Splunk ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(
        `[SplunkAuditLogger] HEC returned ${res.status} for traceId=${entry.traceId}`
      );
    }
  }
}
