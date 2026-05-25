/**
 * DatadogAuditLogger — ships AuditLogEntry objects to Datadog Logs HTTP intake.
 *
 * Docs: https://docs.datadoghq.com/api/latest/logs/#send-logs
 *
 * Usage:
 *   import { DatadogAuditLogger } from '@datacules/agent-identity-audit';
 *   const logger = new DatadogAuditLogger(process.env.DD_API_KEY!);
 *   const router = createRouter(credentials, rules, logger);
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

const DD_INTAKE_URL = 'https://http-intake.logs.datadoghq.com/api/v2/logs';

export class DatadogAuditLogger implements AuditLogger {
  constructor(
    private readonly apiKey: string,
    private readonly service = 'agent-identity',
    private readonly source = 'agent-identity',
    /** Override for EU datacenter: 'https://http-intake.logs.datadoghq.eu/api/v2/logs' */
    private readonly intakeUrl = DD_INTAKE_URL,
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const payload = {
      ddsource: this.source,
      service:  this.service,
      ddtags:   [
        `provider:${entry.provider}`,
        `action:${entry.action}`,
        `resource_kind:${entry.resourceKind}`,
        `credential_kind:${entry.credentialKind}`,
      ].join(','),
      message: JSON.stringify(entry),
      // Datadog uses these top-level fields for log explorer
      trace_id:  entry.traceId,
      user_id:   entry.userId,
      timestamp: entry.timestamp,
    };

    const res = await this.fetchFn(this.intakeUrl, {
      method: 'POST',
      headers: {
        'DD-API-KEY':   this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]), // intake accepts array
    });

    if (!res.ok) {
      console.warn(
        `[DatadogAuditLogger] Intake returned ${res.status} for traceId=${entry.traceId}`
      );
    }
  }
}
