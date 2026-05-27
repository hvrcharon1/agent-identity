# `@datacules/agent-identity-otel`

OpenTelemetry-native tracing for [`@datacules/agent-identity`](../../core). Auto-instruments every `resolve()`, `resolveAsync()`, and `resolvePair()` call with OTEL spans — zero changes to your existing routing code.

## Install

```bash
npm install @datacules/agent-identity-otel @opentelemetry/api
```

## Usage

```typescript
import { createRouter } from '@datacules/agent-identity';
import { withOtel } from '@datacules/agent-identity-otel';
import { trace } from '@opentelemetry/api';

const baseRouter = createRouter(credentials, rules, logger);

// Wrap with OTEL — one line, zero config changes to your rules or credentials
const router = withOtel(baseRouter, {
  tracer: trace.getTracer('agent-identity'),
});

// All resolve calls now emit spans automatically
const resolved = await router.resolveAsync(ctx);
```

## Span schema

| Span name | When |
|-----------|------|
| `agent-identity.resolve` | Synchronous resolve() |
| `agent-identity.resolve_async` | Async resolveAsync() (includes approval + budget checks) |
| `agent-identity.resolve_pair` | Migration pair resolvePair() |

## Span attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `agent.user_id` | string | Calling user ID |
| `agent.provider` | string | AI provider |
| `agent.model` | string | Model name |
| `agent.action` | string | Action being performed |
| `credential.resource_id` | string | Target resource |
| `credential.resource_kind` | string | `shared` or `personal` |
| `credential.id` | string | Resolved credential ID |
| `credential.kind` | string | `fixed` or `user-delegated` |
| `routing.resolved` | boolean | Whether a credential matched |
| `routing.canary` | boolean | Whether the canary ref was selected |
| `routing.resolved_for` | string | `userId` or `service` |
| `trace.id` | string | Agent trace ID |
| `migration.id` | string | Migration ID (pair spans only) |
| `migration.phase` | string | Migration phase (pair spans only) |

## Compatible backends

Works with any OTEL-compatible backend: Datadog APM, Honeycomb, Jaeger, AWS X-Ray, Google Cloud Trace.
