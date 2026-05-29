/**
 * @datacules/agent-identity-anomaly
 *
 * Behavioral baseline and anomaly detection for @datacules/agent-identity.
 * Wraps the audit pipeline — no changes to routing config needed.
 *
 * Each agent ID builds a rolling behavioral baseline over its first N
 * resolutions. A lightweight EWMA model scores each new resolution
 * and emits credential.anomaly audit events when deviations are detected.
 *
 * Usage:
 *   import { AnomalyDetector } from '@datacules/agent-identity-anomaly';
 *
 *   const detector = new AnomalyDetector({ logger, policy: { highAction: 'block' } });
 *
 *   // Wrap resolve calls:
 *   const result = await detector.observe(ctx, () => router.resolveAsync(ctx));
 */
import type { AuditLogEntry, AuditLogger, AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';

// ─── Anomaly signals ────────────────────────────────────────────────────────────

export type AnomalySignal =
  | 'rate_spike'           // calls/hour 3x the rolling average
  | 'new_credential_type'  // credential kind never seen before
  | 'new_action_type'      // action never seen before
  | 'new_resource_kind'    // resource kind never seen before
  | 'off_hours'            // outside established baseline hours
  | 'new_provider';        // AI provider never seen before

export type AnomalySeverity = 'low' | 'medium' | 'high';
export type AnomalyAction = 'warn' | 'throttle' | 'block';

export interface AnomalyEvent {
  signal: AnomalySignal;
  severity: AnomalySeverity;
  baselineValue: unknown;
  observedValue: unknown;
  userId: string;
  credentialId?: string;
  timestamp: string;
}

// ─── Policy ────────────────────────────────────────────────────────────────────────

export interface AnomalyPolicy {
  lowAction?: AnomalyAction;    // default: 'warn'
  mediumAction?: AnomalyAction; // default: 'warn'
  highAction?: AnomalyAction;   // default: 'warn'
  /** How many resolutions to collect before scoring starts (default: 20) */
  baselineSamples?: number;
  /** Rate spike threshold multiplier (default: 3.0) */
  rateSpikeThreshold?: number;
}

// ─── Per-agent baseline ─────────────────────────────────────────────────────────

interface AgentBaseline {
  sampleCount: number;
  knownCredentialKinds: Set<string>;
  knownActions: Set<string>;
  knownResourceKinds: Set<string>;
  knownProviders: Set<string>;
  /** EWMA call rate per hour */
  ewmaRatePerHour: number;
  /** Calls in current 1-hour window */
  callsThisHour: number;
  hourWindowStart: number;
}

function freshBaseline(): AgentBaseline {
  return {
    sampleCount: 0,
    knownCredentialKinds: new Set(),
    knownActions: new Set(),
    knownResourceKinds: new Set(),
    knownProviders: new Set(),
    ewmaRatePerHour: 0,
    callsThisHour: 0,
    hourWindowStart: Date.now(),
  };
}

// ─── AnomalyDetector ───────────────────────────────────────────────────────────

export interface AnomalyDetectorConfig {
  logger: AuditLogger;
  policy?: AnomalyPolicy;
  onAnomaly?: (event: AnomalyEvent) => void;
}

export class AnomalyDetector {
  private readonly baselines = new Map<string, AgentBaseline>();
  private readonly policy: Required<AnomalyPolicy>;

  constructor(private readonly config: AnomalyDetectorConfig) {
    this.policy = {
      lowAction: 'warn',
      mediumAction: 'warn',
      highAction: 'warn',
      baselineSamples: 20,
      rateSpikeThreshold: 3.0,
      ...config.policy,
    };
  }

  /**
   * Wrap a resolveAsync call with anomaly detection.
   * Returns null if the policy action is 'block' and an anomaly is detected.
   */
  async observe(
    ctx: AgentRequestContext,
    resolveFunc: () => Promise<ResolvedCredential | null>
  ): Promise<ResolvedCredential | null> {
    const baseline = this.getOrCreate(ctx.userId);
    const anomalies = this.score(ctx, baseline);

    for (const anomaly of anomalies) {
      await this.emitAnomaly(ctx, anomaly);
      const action = this.actionForSeverity(anomaly.severity);
      if (action === 'block') return null;
    }

    const resolved = await resolveFunc();
    if (resolved) this.updateBaseline(ctx, resolved, baseline);
    return resolved;
  }

  /** Reset a specific agent's baseline (call after investigating an anomaly) */
  resetBaseline(userId: string): void {
    this.baselines.delete(userId);
  }

  private getOrCreate(userId: string): AgentBaseline {
    let b = this.baselines.get(userId);
    if (!b) { b = freshBaseline(); this.baselines.set(userId, b); }
    return b;
  }

  private score(ctx: AgentRequestContext, b: AgentBaseline): AnomalyEvent[] {
    const now = Date.now();

    // Roll hourly window and count calls even during baseline collection
    if (now - b.hourWindowStart > 3_600_000) {
      b.callsThisHour = 0;
      b.hourWindowStart = now;
    }
    b.callsThisHour += 1;

    if (b.sampleCount < this.policy.baselineSamples) return []; // still collecting baseline
    const events: AnomalyEvent[] = [];
    const ts = new Date().toISOString();

    // Rate spike: current hourly rate vs EWMA
    const currentRate = b.callsThisHour;
    if (b.ewmaRatePerHour > 0 && currentRate > b.ewmaRatePerHour * this.policy.rateSpikeThreshold) {
      events.push({ signal: 'rate_spike', severity: 'high', baselineValue: b.ewmaRatePerHour, observedValue: currentRate, userId: ctx.userId, timestamp: ts });
    }

    // New action type
    if (!b.knownActions.has(ctx.action)) {
      events.push({ signal: 'new_action_type', severity: 'medium', baselineValue: [...b.knownActions], observedValue: ctx.action, userId: ctx.userId, timestamp: ts });
    }

    // New resource kind
    if (!b.knownResourceKinds.has(ctx.resourceKind)) {
      events.push({ signal: 'new_resource_kind', severity: 'medium', baselineValue: [...b.knownResourceKinds], observedValue: ctx.resourceKind, userId: ctx.userId, timestamp: ts });
    }

    // New provider
    if (!b.knownProviders.has(ctx.provider)) {
      events.push({ signal: 'new_provider', severity: 'low', baselineValue: [...b.knownProviders], observedValue: ctx.provider, userId: ctx.userId, timestamp: ts });
    }

    return events;
  }

  private updateBaseline(ctx: AgentRequestContext, resolved: ResolvedCredential, b: AgentBaseline): void {
    b.sampleCount += 1;
    b.knownActions.add(ctx.action);
    b.knownResourceKinds.add(ctx.resourceKind);
    b.knownProviders.add(ctx.provider);
    b.knownCredentialKinds.add(resolved.kind);
    // EWMA update: alpha = 0.1
    b.ewmaRatePerHour = b.ewmaRatePerHour === 0
      ? b.callsThisHour
      : 0.1 * b.callsThisHour + 0.9 * b.ewmaRatePerHour;
  }

  private actionForSeverity(severity: AnomalySeverity): AnomalyAction {
    if (severity === 'high') return this.policy.highAction;
    if (severity === 'medium') return this.policy.mediumAction;
    return this.policy.lowAction;
  }

  private async emitAnomaly(ctx: AgentRequestContext, event: AnomalyEvent): Promise<void> {
    this.config.onAnomaly?.(event);
    const entry: AuditLogEntry & Record<string, unknown> = {
      timestamp: event.timestamp,
      traceId: ctx.traceId,
      userId: ctx.userId,
      action: 'credential.anomaly',
      resourceId: ctx.resourceId,
      resourceKind: ctx.resourceKind,
      provider: ctx.provider,
      model: ctx.model,
      credentialId: event.credentialId ?? 'unknown',
      credentialKind: 'fixed',
      resolvedFor: ctx.userId,
      signal: event.signal,
      severity: event.severity,
      baselineValue: event.baselineValue,
      observedValue: event.observedValue,
    };
    // AuditLogger.log() returns void | Promise<void>. Wrap in Promise.resolve()
    // so .catch() is always valid regardless of whether the implementation is
    // sync (returns void) or async (returns Promise<void>).
    await Promise.resolve(this.config.logger.log(entry as AuditLogEntry)).catch(console.error);
  }
}
