<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-otel`

OpenTelemetry tracing wrapper for the agent-identity framework. Wraps any `CredentialRouter` and emits spans on every `resolve()`, `resolveAsync()`, `resolvePair()`, and `resolvePairAsync()` call so credential resolution appears in your existing distributed traces.

## Install

```bash
npm install @datacules/agent-identity-otel
# peer dependencies:
npm install @opentelemetry/api
```

## Usage

```typescript
import { withOtel }    from '@datacules/agent-identity-otel';
import { createRouter } from '@datacules/agent-identity';
import { trace }       from '@opentelemetry/api';

const router = withOtel(
  createRouter(credentials, rules, logger),
  { tracer: trace.getTracer('agent-identity') }
);

// Use exactly as before — spans are emitted transparently
const resolved = await router.resolveAsync(ctx);
```

The spans nest inside your existing application traces in **Datadog APM, Honeycomb, Jaeger, or AWS X-Ray** — no extra configuration required beyond your existing OTEL SDK setup.

## Span schema

| Span name | Operation |
|-----------|----------|
| `agent_identity.resolve` | `router.resolve()` |
| `agent_identity.resolve_async` | `router.resolveAsync()` |
| `agent_identity.resolve_pair` | `router.resolvePair()` |
| `agent_identity.resolve_pair_async` | `router.resolvePairAsync()` |
| `agent_identity.store.get` | `CredentialStore.findByRef()` |
| `agent_identity.audit.emit` | `AuditLogger.log()` |

## Span attributes

| Attribute | Example |
|-----------|--------|
| `agent_identity.provider` | `anthropic` |
| `agent_identity.user_id` | `user-abc` |
| `agent_identity.resource_id` | `knowledge-base` |
| `agent_identity.resource_kind` | `personal` |
| `agent_identity.action` | `read` |
| `agent_identity.credential_id` | `cred-anthropic-prod` |
| `agent_identity.resolved_for` | `user-abc` |
| `agent_identity.trace_id` | `<uuid>` |
| `agent_identity.is_canary` | `false` |
| `agent_identity.model` | `claude-sonnet-4-20250514` |

## Dashboard tab

The **OTEL tracing** tab in the interactive dashboard at `localhost:3000` shows a live span emitter, span schema reference, attribute grid, and backend compatibility switcher.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
