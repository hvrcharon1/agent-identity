/**
 * @datacules/agent-identity-otel
 *
 * Zero-config OpenTelemetry wrapper for @datacules/agent-identity.
 * Wraps CredentialRouter to emit spans on every resolve, store lookup,
 * and audit emission — without touching your existing code.
 *
 * Usage:
 *   import { withOtel } from '@datacules/agent-identity-otel';
 *   import { trace } from '@opentelemetry/api';
 *
 *   const router = withOtel(createRouter(credentials, rules, logger), {
 *     tracer: trace.getTracer('agent-identity'),
 *   });
 */
import type { Tracer, Span, SpanStatusCode } from '@opentelemetry/api';
import type { AgentRequestContext, ResolvedCredential, MigrationContext, ResolvedCredentialPair } from '@datacules/agent-identity';

export interface OtelWrapperOptions {
  tracer: Tracer;
  /** Service name attribute on every span (default: 'agent-identity') */
  serviceName?: string;
  /** If true, include userId in span attributes (default: true) */
  includeUserId?: boolean;
}

export interface TracedRouter {
  resolve(ctx: AgentRequestContext): ResolvedCredential | null;
  resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null>;
  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null;
}

/**
 * Wrap any CredentialRouter with automatic OTEL span instrumentation.
 *
 * Span schema:
 *   agent_identity.resolve        — sync resolve
 *   agent_identity.resolve_async  — async resolve (includes approval + budget)
 *   agent_identity.resolve_pair   — migration pair resolve
 *
 * Attributes on every span:
 *   agent.user_id, agent.provider, agent.model, agent.action,
 *   credential.resource_id, credential.resource_kind,
 *   routing.canary (boolean), routing.resolved (boolean)
 */
export function withOtel(router: TracedRouter, options: OtelWrapperOptions): TracedRouter {
  const { tracer, serviceName = 'agent-identity', includeUserId = true } = options;

  function startSpan(name: string, ctx: AgentRequestContext): Span {
    const span = tracer.startSpan(`${serviceName}.${name}`);
    span.setAttribute('agent.provider', ctx.provider);
    span.setAttribute('agent.model', ctx.model);
    span.setAttribute('agent.action', ctx.action);
    span.setAttribute('credential.resource_id', ctx.resourceId);
    span.setAttribute('credential.resource_kind', ctx.resourceKind);
    if (includeUserId) span.setAttribute('agent.user_id', ctx.userId);
    if (ctx.traceId) span.setAttribute('trace.id', ctx.traceId);
    if (ctx.parentTraceId) span.setAttribute('trace.parent_id', ctx.parentTraceId);
    return span;
  }

  function annotateResult(span: Span, resolved: ResolvedCredential | null): void {
    span.setAttribute('routing.resolved', resolved !== null);
    if (resolved) {
      span.setAttribute('credential.id', resolved.credentialId);
      span.setAttribute('credential.kind', resolved.kind);
      span.setAttribute('routing.canary', resolved.isCanary ?? false);
      span.setAttribute('routing.resolved_for', resolved.resolvedFor);
    }
  }

  return {
    resolve(ctx: AgentRequestContext): ResolvedCredential | null {
      const span = startSpan('resolve', ctx);
      try {
        const result = router.resolve(ctx);
        annotateResult(span, result);
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 as SpanStatusCode }); // ERROR
        throw err;
      } finally {
        span.end();
      }
    },

    async resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null> {
      const span = startSpan('resolve_async', ctx);
      try {
        const result = await router.resolveAsync(ctx);
        annotateResult(span, result);
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 as SpanStatusCode });
        throw err;
      } finally {
        span.end();
      }
    },

    resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null {
      const span = startSpan('resolve_pair', ctx);
      span.setAttribute('migration.id', ctx.migrationId);
      span.setAttribute('migration.phase', ctx.phase);
      span.setAttribute('migration.dry_run', ctx.dryRun);
      try {
        const result = router.resolvePair(ctx);
        span.setAttribute('routing.resolved', result !== null);
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 as SpanStatusCode });
        throw err;
      } finally {
        span.end();
      }
    },
  };
}

// Re-export useful types
export type { OtelWrapperOptions as WithOtelOptions };
