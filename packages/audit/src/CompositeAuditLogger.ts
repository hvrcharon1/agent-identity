/**
 * CompositeAuditLogger — fans out log() calls to multiple loggers simultaneously.
 *
 * Useful when you need to send audit entries to Datadog AND a webhook sink at once.
 *
 * Usage:
 *   import { CompositeAuditLogger, DatadogAuditLogger, WebhookAuditLogger } from '@datacules/agent-identity-audit';
 *
 *   const logger = new CompositeAuditLogger([
 *     new DatadogAuditLogger(process.env.DD_API_KEY!),
 *     new WebhookAuditLogger('https://hooks.example.com/ai'),
 *   ]);
 *   const router = createRouter(credentials, rules, logger);
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

export class CompositeAuditLogger implements AuditLogger {
  constructor(private readonly loggers: AuditLogger[]) {}

  async log(entry: AuditLogEntry): Promise<void> {
    // Fire all sinks concurrently; individual failures are caught and warned
    await Promise.allSettled(
      this.loggers.map((l) =>
        l.log(entry).catch((err) =>
          console.warn(`[CompositeAuditLogger] Sink ${l.constructor.name} threw:`, err)
        )
      )
    );
  }
}
