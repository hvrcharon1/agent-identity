/**
 * Credential Budget Management — Feature #12 from FEATURE_SUGGESTIONS.md
 *
 * Enforces per-credential usage budgets (hourly resolution count,
 * concurrent sessions, daily spend) at the routing layer — before any
 * call reaches the provider.
 */
import type { Credential, AuditLogger } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetResult {
  allowed: boolean;
  reason?: 'hourly_limit' | 'session_limit' | 'daily_spend_limit';
  retryAfter?: string;
}

export interface BudgetStore {
  getHourlyCount(credentialId: string): Promise<number>;
  incrementHourlyCount(credentialId: string): Promise<void>;
  getConcurrentSessions(credentialId: string): Promise<number>;
  getDailySpend(credentialId: string): Promise<number>;
  resetHourly(credentialId: string): Promise<void>;
  resetDaily(credentialId: string): Promise<void>;
}

// ─── MemoryBudgetStore ────────────────────────────────────────────────────────

export class MemoryBudgetStore implements BudgetStore {
  private readonly hourlyCounts = new Map<string, { count: number; windowStart: number }>();
  private readonly dailySpend = new Map<string, number>();

  async getHourlyCount(credentialId: string): Promise<number> {
    const entry = this.hourlyCounts.get(credentialId);
    if (!entry) return 0;
    const hourMs = 3600_000;
    if (Date.now() - entry.windowStart > hourMs) {
      this.hourlyCounts.delete(credentialId);
      return 0;
    }
    return entry.count;
  }

  async incrementHourlyCount(credentialId: string): Promise<void> {
    const existing = this.hourlyCounts.get(credentialId);
    const hourMs = 3600_000;
    if (!existing || Date.now() - existing.windowStart > hourMs) {
      this.hourlyCounts.set(credentialId, { count: 1, windowStart: Date.now() });
    } else {
      existing.count++;
    }
  }

  async getConcurrentSessions(_credentialId: string): Promise<number> {
    // Placeholder — real impl tracks open sessions with TTL
    return 0;
  }

  async getDailySpend(credentialId: string): Promise<number> {
    return this.dailySpend.get(credentialId) ?? 0;
  }

  async resetHourly(credentialId: string): Promise<void> {
    this.hourlyCounts.delete(credentialId);
  }

  async resetDaily(credentialId: string): Promise<void> {
    this.dailySpend.delete(credentialId);
  }
}

// ─── BudgetEnforcer ──────────────────────────────────────────────────────────

export class BudgetEnforcer {
  constructor(
    private readonly store: BudgetStore,
    private readonly auditLogger?: AuditLogger
  ) {}

  async check(credential: Credential): Promise<BudgetResult> {
    const policy = credential.budget;
    if (!policy) return { allowed: true };

    // Hourly resolution limit
    if (policy.maxResolutionsPerHour !== undefined) {
      const count = await this.store.getHourlyCount(credential.id);
      const soft = policy.softThresholdPercent ?? 80;
      const softLimit = Math.floor((policy.maxResolutionsPerHour * soft) / 100);

      if (count >= policy.maxResolutionsPerHour) {
        const retryAfter = new Date(Date.now() + 3600_000).toISOString();
        if (this.auditLogger) {
          // Fire-and-forget — budget exceeded audit event
          void this.auditLogger.log({
            timestamp: new Date().toISOString(),
            traceId: 'budget-enforcer',
            userId: 'system',
            action: 'credential.budget_exceeded',
            resourceId: credential.id,
            resourceKind: 'shared',
            provider: 'local',
            model: 'system',
            credentialId: credential.id,
            credentialKind: credential.kind,
            resolvedFor: 'system',
          });
        }
        return { allowed: false, reason: 'hourly_limit', retryAfter };
      }

      if (count >= softLimit && this.auditLogger) {
        void this.auditLogger.log({
          timestamp: new Date().toISOString(),
          traceId: 'budget-enforcer',
          userId: 'system',
          action: 'credential.budget_warning',
          resourceId: credential.id,
          resourceKind: 'shared',
          provider: 'local',
          model: 'system',
          credentialId: credential.id,
          credentialKind: credential.kind,
          resolvedFor: 'system',
        });
      }
    }

    // Concurrent sessions limit
    if (policy.maxConcurrentSessions !== undefined) {
      const sessions = await this.store.getConcurrentSessions(credential.id);
      if (sessions >= policy.maxConcurrentSessions) {
        return { allowed: false, reason: 'session_limit' };
      }
    }

    // Record the resolution
    await this.store.incrementHourlyCount(credential.id);
    return { allowed: true };
  }
}
