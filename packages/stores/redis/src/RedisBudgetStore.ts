import type { BudgetStore } from '@datacules/agent-identity';
import type Redis from 'ioredis';

export interface RedisBudgetStoreOptions {
  redis: Redis;
  prefix?: string;
  hourlyWindowMs?: number;
}

export class RedisBudgetStore implements BudgetStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly hourlyWindowMs: number;

  constructor(opts: RedisBudgetStoreOptions) {
    this.redis = opts.redis;
    this.prefix = opts.prefix ?? 'ai-budget:';
    this.hourlyWindowMs = opts.hourlyWindowMs ?? 3_600_000;
  }

  private hourlyKey(credentialId: string): string {
    return `${this.prefix}hourly:${credentialId}`;
  }

  private dailyKey(credentialId: string): string {
    return `${this.prefix}daily:${credentialId}`;
  }

  private sessionsKey(credentialId: string): string {
    return `${this.prefix}sessions:${credentialId}`;
  }

  async getHourlyCount(credentialId: string): Promise<number> {
    const key = this.hourlyKey(credentialId);
    const now = Date.now();
    const windowStart = now - this.hourlyWindowMs;

    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    return this.redis.zcount(key, windowStart, '+inf');
  }

  async incrementHourlyCount(credentialId: string): Promise<void> {
    const key = this.hourlyKey(credentialId);
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, now, member);
    pipeline.zremrangebyscore(key, '-inf', now - this.hourlyWindowMs);
    pipeline.expire(key, Math.ceil(this.hourlyWindowMs / 1000) + 60);
    await pipeline.exec();
  }

  async getConcurrentSessions(credentialId: string): Promise<number> {
    const key = this.sessionsKey(credentialId);
    const now = Date.now();
    await this.redis.zremrangebyscore(key, '-inf', now);
    return this.redis.zcard(key);
  }

  async getDailySpend(credentialId: string): Promise<number> {
    const key = this.dailyKey(credentialId);
    const value = await this.redis.get(key);
    return value ? parseFloat(value) : 0;
  }

  async recordSpend(credentialId: string, amountUsd: number): Promise<void> {
    const key = this.dailyKey(credentialId);
    await this.redis.incrbyfloat(key, amountUsd);
    const ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      const secondsUntilMidnight = this.getSecondsUntilMidnightUTC();
      await this.redis.expire(key, secondsUntilMidnight);
    }
  }

  async resetHourly(credentialId: string): Promise<void> {
    await this.redis.del(this.hourlyKey(credentialId));
  }

  async resetDaily(credentialId: string): Promise<void> {
    await this.redis.del(this.dailyKey(credentialId));
  }

  async addSession(credentialId: string, sessionId: string, ttlMs: number): Promise<void> {
    const key = this.sessionsKey(credentialId);
    const expiresAt = Date.now() + ttlMs;
    await this.redis.zadd(key, expiresAt, sessionId);
  }

  async removeSession(credentialId: string, sessionId: string): Promise<void> {
    const key = this.sessionsKey(credentialId);
    await this.redis.zrem(key, sessionId);
  }

  private getSecondsUntilMidnightUTC(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0
    ));
    return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  }
}
