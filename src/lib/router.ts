/**
 * Credential Router
 *
 * Resolves which credential an agent should use for a given request.
 * The model/LLM layer never receives raw credentials — the router
 * injects them at call time based on explicit routing rules.
 *
 * Enhancements applied:
 * - Finding #2: Multi-field matching (resourceKind, action, provider, userId) with priority
 * - Finding #5: Accepts CredentialStore + AuditLogger interfaces (dependency injection)
 * - Finding #7: Rejects expired credentials
 * - Finding #11: traceId included in audit entries
 */

import type {
  AgentRequestContext,
  AuditLogEntry,
  AuditLogger,
  Credential,
  CredentialStore,
  ResolvedCredential,
  RoutingRule,
} from './types';

// ─── In-memory CredentialStore (default for local dev) ────────────────────────

export class MemoryCredentialStore implements CredentialStore {
  private readonly creds: Credential[];

  constructor(credentials: Credential[]) {
    this.creds = credentials;
  }

  findByRefSync(ref: string): Credential | null {
    return this.creds.find((c) => c.ref === ref && c.status === 'active') ?? null;
  }

  async findByRef(ref: string): Promise<Credential | null> {
    return this.findByRefSync(ref);
  }

  async listActive(): Promise<Credential[]> {
    return this.creds.filter((c) => c.status === 'active');
  }

  async listByKind(kind: Credential['kind']): Promise<Credential[]> {
    return this.creds.filter((c) => c.kind === kind);
  }
}

// ─── CredentialRouter ─────────────────────────────────────────────────────────

export class CredentialRouter {
  constructor(
    private store: CredentialStore,
    private rules: RoutingRule[],
    private logger?: AuditLogger
  ) {}

  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    const matching = this.rules
      .filter((r) => this.ruleMatches(r, ctx))
      .sort((a, b) => b.priority - a.priority);

    const rule = matching[0];
    if (!rule) return null;

    if (!(this.store instanceof MemoryCredentialStore)) {
      console.warn(
        '[CredentialRouter] resolve() is synchronous but store is not a MemoryCredentialStore. ' +
          'Use POST /api/resolve for async credential stores.'
      );
      return null;
    }

    const cred = this.store.findByRefSync(rule.credentialRef);
    if (!cred) return null;

    const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();
    if (isExpired) return null;

    const resolved: ResolvedCredential = {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
    };

    if (this.logger) {
      this.logger.log(this.buildAuditEntry(ctx, resolved)).catch(console.error);
    }

    return resolved;
  }

  private ruleMatches(rule: RoutingRule, ctx: AgentRequestContext): boolean {
    if (rule.matchResourceKind && rule.matchResourceKind !== ctx.resourceKind) return false;
    if (rule.matchProvider && rule.matchProvider !== ctx.provider) return false;
    if (rule.matchUserId && rule.matchUserId !== ctx.userId) return false;
    if (rule.matchAction) {
      const actions = Array.isArray(rule.matchAction) ? rule.matchAction : [rule.matchAction];
      if (!actions.includes(ctx.action)) return false;
    }
    return true;
  }

  private buildAuditEntry(
    ctx: AgentRequestContext,
    resolved: ResolvedCredential
  ): AuditLogEntry {
    return {
      timestamp: new Date().toISOString(),
      traceId: ctx.traceId,
      userId: ctx.userId,
      action: ctx.action,
      resourceId: ctx.resourceId,
      resourceKind: ctx.resourceKind,
      provider: ctx.provider,
      model: ctx.model,
      credentialId: resolved.credentialId,
      credentialKind: resolved.kind,
      resolvedFor: resolved.resolvedFor,
    };
  }

  /** @deprecated Kept for backward compat — use the typed buildAuditEntry instead. */
  auditEntry(
    ctx: AgentRequestContext,
    resolved: ResolvedCredential
  ): Record<string, unknown> {
    // Cast via unknown first to satisfy strict TS2352 overlap check
    return this.buildAuditEntry(ctx, resolved) as unknown as Record<string, unknown>;
  }
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createRouter(
  credentials: Credential[],
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter(new MemoryCredentialStore(credentials), rules, logger);
}

export function createRouterFromStore(
  store: CredentialStore,
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter(store, rules, logger);
}
