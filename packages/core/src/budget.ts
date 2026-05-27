/**
 * Credential Budget Management — @datacules/agent-identity core
 *
 * Enforces hard and soft resolution limits per credential at the routing layer,
 * before any call reaches the AI provider. Prevents runaway agents from
 * exhausting quotas or generating unexpected cost spikes.
 */
import type { Credential, BudgetPolicy, AuditLogger } from './types';

// ─── Budget counters ─────────────────────────────────────────────────────────

interface BudgetCounters {
  resolutionsThisHour: number;
  hourWindowStart: number;
  activeSessions: number;
  spendTodayUsd: number;
  dayWindowStart: number;
}

function freshCounters(): BudgetCounters {
  return {
    resolutionsThisHour: 0,
    hourWindowStart: Date.now(),
    activeSessions: 0,
    spendTodayUsd: 0,
    dayWindowStart: Date.now(),
  };
}

// ─── Budget enforcement result ───────────────────────────────────────────────

export type BudgetResult =
  | { allowed: true; warning?: string }
  | { allowed: false; reason: string; retryAfter: string };

// ─── Budget Store ────────────────────────────────────────────────────────────

export interface BudgetStore {
  getCounters(credentialId: string): Promise<BudgetCounters>;
  setCounters(credentialId: string, counters: BudgetCounters): Promise<void>;
}

export class MemoryBudgetStore implements BudgetStore {
  private data = new Map<string, BudgetCounters>();

  async getCounters(credentialId: string): Promise<BudgetCounters> {
    return this.data.get(credentialId) ?? freshCounters();
  }

  async setCounters(credentialId: string, counters: BudgetCounters): Promise<void> {
    this.data.set(credentialId, counters);
  }
}

// ─── Budget Enforcer ─────────────────────────────────────────────────────────

export class BudgetEnforcer {
  constructor(
    private readonly store: BudgetStore,
    private readonly logger?: AuditLogger
  ) {}

  /** Check and record a new resolution. Call before returning ResolvedCredential. */
  async check(credential: Credential): Promise<BudgetResult> {
    if (!credential.budget) return { allowed: true };
    const policy = credential.budget;
    const threshold = (policy.softThresholdPercent ?? 80) / 100;
    const now = Date.now();

    let counters = await this.store.getCounters(credential.id);

    // Roll hourly window
    if (now - counters.hourWindowStart > 3_600_000) {
      counters = { ...counters, resolutionsThisHour: 0, hourWindowStart: now };
    }
    // Roll daily window
    if (now - counters.dayWindowStart > 86_400_000) {
      counters = { ...counters, spendTodayUsd: 0, dayWindowStart: now };
    }

    // Hard limit: resolutions/hour
    if (policy.maxResolutionsPerHour !== undefined) {
      if (counters.resolutionsThisHour >= policy.maxResolutionsPerHour) {
        const retryAfter = new Date(counters.hourWindowStart + 3_600_000).toISOString();
        await this.emitExceeded(credential, 'maxResolutionsPerHour');
        return { allowed: false, reason: 'hourly resolution budget exceeded', retryAfter };
      }
    }

    // Hard limit: concurrent sessions
    if (policy.maxConcurrentSessions !== undefined) {
      if (counters.activeSessions >= policy.maxConcurrentSessions) {
        await this.emitExceeded(credential, 'maxConcurrentSessions');
        return { allowed: false, reason: 'concurrent session limit reached', retryAfter: new Date().toISOString() };
      }
    }

    // Record the resolution
    counters.resolutionsThisHour += 1;
    counters.activeSessions += 1;
    await this.store.setCounters(credential.id, counters);

    // Soft warning
    let warning: string | undefined;
    if (
      policy.maxResolutionsPerHour !== undefined &&
      counters.resolutionsThisHour / policy.maxResolutionsPerHour >= threshold
    ) {
      warning = `credential ${credential.id} is at ${Math.round((counters.resolutionsThisHour / policy.maxResolutionsPerHour) * 100)}% of hourly resolution budget`;
      await this.emitWarning(credential, warning);
    }

    return { allowed: true, warning };
  }

  /** Call when the agent session ends to decrement active session count */
  async releaseSession(credentialId: string): Promise<void> {
    const counters = await this.store.getCounters(credentialId);
    await this.store.setCounters(credentialId, {
      ...counters,
      activeSessions: Math.max(0, counters.activeSessions - 1),
    });
  }

  private async emitExceeded(credential: Credential, limitKind: string): Promise<void> {
    if (!this.logger) return;
    await this.logger.log({
      timestamp: new Date().toISOString(),
      traceId: `budget-${credential.id}-${Date.now()}`,
      userId: 'system:budget-enforcer',
      action: 'credential.budget_exceeded',
      resourceId: credential.ref,
      resourceKind: 'shared',
      provider: 'local',
      model: 'system',
      credentialId: credential.id,
      credentialKind: credential.kind,
      resolvedFor: 'system',
    }).catch(console.error);
    void limitKind;
  }

  private async emitWarning(credential: Credential, warning: string): Promise<void> {
    if (!this.logger) return;
    await this.logger.log({
      timestamp: new Date().toISOString(),
      traceId: `budget-warn-${credential.id}-${Date.now()}`,
      userId: 'system:budget-enforcer',
      action: 'credential.budget_warning',
      resourceId: credential.ref,
      resourceKind: 'shared',
      provider: 'local',
      model: 'system',
      credentialId: credential.id,
      credentialKind: credential.kind,
      resolvedFor: 'system',
    }).catch(console.error);
    void warning;
  }
}
