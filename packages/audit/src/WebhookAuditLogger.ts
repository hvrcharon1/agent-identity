/**
 * WebhookAuditLogger — posts every AuditLogEntry to a webhook URL.
 *
 * Optionally signs the payload with a shared secret via the X-Webhook-Secret
 * header so the receiver can verify the request originated from agent-identity.
 *
 * Usage:
 *   import { WebhookAuditLogger } from '@datacules/agent-identity-audit';
 *   const logger = new WebhookAuditLogger('https://hooks.example.com/ai-events', process.env.WEBHOOK_SECRET);
 *   const router = createRouter(credentials, rules, logger);
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

export class WebhookAuditLogger implements AuditLogger {
  constructor(
    private readonly webhookUrl: string,
    private readonly secret?: string,
    /** Optional: custom fetch implementation (useful for testing) */
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.secret) headers['X-Webhook-Secret'] = this.secret;

    const res = await this.fetchFn(this.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
    });

    if (!res.ok) {
      // Non-blocking warning — audit failures should never crash the agent
      console.warn(
        `[WebhookAuditLogger] Webhook returned ${res.status} for traceId=${entry.traceId}`
      );
    }
  }
}
