/**
 * @datacules/agent-identity-audit
 * Pre-built audit log sinks for the @datacules/agent-identity credential router.
 *
 * All sinks implement the AuditLogger interface from the core package,
 * so any of them can be passed directly to createRouter().
 *
 * Sinks:
 *   ConsoleAuditLogger   — stdout, for local dev
 *   WebhookAuditLogger   — any HTTP webhook endpoint
 *   DatadogAuditLogger   — Datadog Logs HTTP intake
 *   SplunkAuditLogger    — Splunk HEC
 *   CompositeAuditLogger — fan-out to multiple sinks at once
 */
export { ConsoleAuditLogger }   from './ConsoleAuditLogger';
export { WebhookAuditLogger }   from './WebhookAuditLogger';
export { DatadogAuditLogger }   from './DatadogAuditLogger';
export { SplunkAuditLogger }    from './SplunkAuditLogger';
export { CompositeAuditLogger } from './CompositeAuditLogger';
