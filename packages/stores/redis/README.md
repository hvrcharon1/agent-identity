# @datacules/agent-identity-store-redis

Redis-backed budget store for `@datacules/agent-identity`. Uses sorted sets (`ZADD`/`ZRANGEBYSCORE`) for sliding-window rate limiting that scales across multiple replicas without coordination.

## Installation

```bash
npm install @datacules/agent-identity-store-redis ioredis
```

## Usage

```typescript
import { RedisBudgetStore } from '@datacules/agent-identity-store-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const budgetStore = new RedisBudgetStore({ redis });

// Get current hourly resolution count (sliding window)
const count = await budgetStore.getHourlyCount('cred-openai-prod');

// Increment after a successful resolution
await budgetStore.incrementHourlyCount('cred-openai-prod');

// Reset counters
await budgetStore.resetHourly('cred-openai-prod');
await budgetStore.resetDaily('cred-openai-prod');
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `redis` | `Redis` | required | ioredis client instance |
| `prefix` | `string` | `"ai-budget:"` | Key prefix for all Redis keys |
| `hourlyWindowMs` | `number` | `3600000` | Sliding window size for hourly counts |

## How it works

- **Hourly counts** use Redis sorted sets with timestamps as scores. `ZADD` inserts each resolution event; `ZRANGEBYSCORE` counts events within the sliding window; expired entries are pruned with `ZREMRANGEBYSCORE`.
- **Daily spend** uses a simple Redis key with TTL matching the reset schedule.
- **Concurrent sessions** are tracked via a Redis set with per-session TTL members.

## License

See LICENSE in repository root.
