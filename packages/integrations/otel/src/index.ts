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
  /** Service name prefix on every span (default: 'agent-identity') */
  serviceName?: string;
  /** If true, include userId in span attributes (default: true) */
  includeUserId?: boolean;
}

/**
 * Structural interface that CredentialRouter satisfies.
 * withOtel() accepts any object that matches this shape — not just
 * CredentialRouter — so it works with any custom router implementation.
 */
export interface TracedRouter {
  resolve(ctx: AgentRequestContext): ResolvedCredential | null;
  resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null>;
  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null;
  /**
   * Async counterpart of resolvePair() — benefits from budget enforcement,
   * attestation, and approval gates on migration workflows.
   * Added to TracedRouter to match the method added to CredentialRouter in
   * the v0.3.0 hardening pass (PR #19).
   */
  resolvePairAsync(ctx: MigrationContext): Promise<ResolvedCredentialPair | null>;
}

/**
 * Wrap any CredentialRouter with automatic OTEL span instrumentation.
 *
 * Span schema:
 *   agent_identity.resolve           — sync resolve
 *   agent_identity.resolve_async     — async resolve (includes approval + budget)
 *   agent_identity.resolve_pair      — migration pair resolve (sync)
 *   agent_identity.resolve_pair_async — migration pair resolve (async)
 *
 * Attributes on every span:
 *   agent.user_id, agent.provider, agent.model, agent.action,
 *   credential.resource_id, credential.resource_kind,
 *   routing.canary (boolean), routing.resolved (boolean)
 *
 * Migration spans also set:
 *   migration.id, migration.phase, migration.dry_run
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

  function annotateMigrationCtx(span: Span, ctx: MigrationContext): void {
    span.setAttribute('migration.id', ctx.migrationId);
    span.setAttribute('migration.phase', ctx.phase);
    span.setAttribute('migration.dry_run', ctx.dryRun);
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
      annotateMigrationCtx(span, ctx);
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

    async resolvePairAsync(ctx: MigrationContext): Promise<ResolvedCredentialPair | null> {
      const span = startSpan('resolve_pair_async', ctx);
      annotateMigrationCtx(span, ctx);
      try {
        const result = await router.resolvePairAsync(ctx);
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
