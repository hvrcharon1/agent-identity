/**
 * RedisBudgetStore unit tests (18 cases)
 *
 * Uses a mock Redis client that simulates sorted set operations in-memory.
 * No real Redis connection required.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RedisBudgetStore } from './RedisBudgetStore';

// ─── Mock Redis client ───────────────────────────────────────────────────────

class MockRedis {
  private readonly store = new Map<string, string>();
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private readonly ttls = new Map<string, number>();

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.sortedSets.has(key)) this.sortedSets.set(key, new Map());
    this.sortedSets.get(key)!.set(member, score);
    return 1;
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    const minVal = min === '-inf' ? -Infinity : typeof min === 'string' ? parseFloat(min) : min;
    const maxVal = max === '+inf' ? Infinity : typeof max === 'string' ? parseFloat(max) : max;
    let count = 0;
    for (const score of set.values()) {
      if (score >= minVal && score <= maxVal) count++;
    }
    return count;
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.size ?? 0;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    const minVal = min === '-inf' ? -Infinity : typeof min === 'string' ? parseFloat(min) : min;
    const maxVal = max === '+inf' ? Infinity : typeof max === 'string' ? parseFloat(max) : max;
    let removed = 0;
    for (const [member, score] of set.entries()) {
      if (score >= minVal && score <= maxVal) {
        set.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
      if (this.sortedSets.delete(k)) count++;
    }
    return count;
  }

  async incrbyfloat(key: string, increment: number): Promise<string> {
    const current = parseFloat(this.store.get(key) ?? '0');
    const next = (current + increment).toString();
    this.store.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }

  pipeline() {
    const commands: Array<{ method: string; args: unknown[] }> = [];
    const self = this;
    const pipe = {
      zadd(key: string, score: number, member: string) { commands.push({ method: 'zadd', args: [key, score, member] }); return pipe; },
      zremrangebyscore(key: string, min: unknown, max: unknown) { commands.push({ method: 'zremrangebyscore', args: [key, min, max] }); return pipe; },
      expire(key: string, seconds: number) { commands.push({ method: 'expire', args: [key, seconds] }); return pipe; },
      async exec() {
        const results: Array<[null, unknown]> = [];
        for (const cmd of commands) {
          const fn = (self as any)[cmd.method].bind(self);
          const result = await fn(...cmd.args);
          results.push([null, result]);
        }
        return results;
      },
    };
    return pipe;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RedisBudgetStore', () => {
  let redis: MockRedis;
  let store: RedisBudgetStore;

  beforeEach(() => {
    redis = new MockRedis();
    store = new RedisBudgetStore({ redis: redis as any });
  });

  describe('getHourlyCount', () => {
    it('returns 0 for a new credential', async () => {
      expect(await store.getHourlyCount('cred-1')).toBe(0);
    });

    it('returns the count after increments', async () => {
      await store.incrementHourlyCount('cred-1');
      await store.incrementHourlyCount('cred-1');
      await store.incrementHourlyCount('cred-1');
      expect(await store.getHourlyCount('cred-1')).toBe(3);
    });

    it('expires old entries outside the window', async () => {
      const oldStore = new RedisBudgetStore({
        redis: redis as any,
        hourlyWindowMs: 1000,
      });
      // Manually add an old entry
      await redis.zadd('ai-budget:hourly:cred-1', Date.now() - 2000, 'old-entry');
      expect(await oldStore.getHourlyCount('cred-1')).toBe(0);
    });
  });

  describe('incrementHourlyCount', () => {
    it('adds a unique member to the sorted set', async () => {
      await store.incrementHourlyCount('cred-1');
      await store.incrementHourlyCount('cred-1');
      const count = await store.getHourlyCount('cred-1');
      expect(count).toBe(2);
    });

    it('uses the configured prefix', async () => {
      const prefixed = new RedisBudgetStore({ redis: redis as any, prefix: 'custom:' });
      await prefixed.incrementHourlyCount('cred-1');
      const count = await redis.zcount('custom:hourly:cred-1', '-inf', '+inf');
      expect(count).toBe(1);
    });
  });

  describe('getConcurrentSessions', () => {
    it('returns 0 when no sessions exist', async () => {
      expect(await store.getConcurrentSessions('cred-1')).toBe(0);
    });

    it('counts active sessions', async () => {
      await store.addSession('cred-1', 'session-a', 60_000);
      await store.addSession('cred-1', 'session-b', 60_000);
      expect(await store.getConcurrentSessions('cred-1')).toBe(2);
    });

    it('excludes expired sessions', async () => {
      await redis.zadd('ai-budget:sessions:cred-1', Date.now() - 1000, 'expired-session');
      expect(await store.getConcurrentSessions('cred-1')).toBe(0);
    });
  });

  describe('getDailySpend', () => {
    it('returns 0 when no spend recorded', async () => {
      expect(await store.getDailySpend('cred-1')).toBe(0);
    });

    it('returns accumulated spend', async () => {
      await store.recordSpend('cred-1', 10.50);
      await store.recordSpend('cred-1', 5.25);
      expect(await store.getDailySpend('cred-1')).toBeCloseTo(15.75);
    });
  });

  describe('recordSpend', () => {
    it('increments the daily spend key', async () => {
      await store.recordSpend('cred-1', 42.0);
      expect(await store.getDailySpend('cred-1')).toBe(42.0);
    });

    it('sets TTL on first write', async () => {
      await store.recordSpend('cred-1', 1.0);
      const ttl = await redis.ttl('ai-budget:daily:cred-1');
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('resetHourly', () => {
    it('clears the hourly sorted set', async () => {
      await store.incrementHourlyCount('cred-1');
      await store.incrementHourlyCount('cred-1');
      await store.resetHourly('cred-1');
      expect(await store.getHourlyCount('cred-1')).toBe(0);
    });
  });

  describe('resetDaily', () => {
    it('clears the daily spend key', async () => {
      await store.recordSpend('cred-1', 100.0);
      await store.resetDaily('cred-1');
      expect(await store.getDailySpend('cred-1')).toBe(0);
    });
  });

  describe('addSession / removeSession', () => {
    it('adds and removes a session', async () => {
      await store.addSession('cred-1', 'sess-x', 30_000);
      expect(await store.getConcurrentSessions('cred-1')).toBe(1);
      await store.removeSession('cred-1', 'sess-x');
      expect(await store.getConcurrentSessions('cred-1')).toBe(0);
    });
  });
});
