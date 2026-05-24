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

// ─── In-memory CredentialStore (default for local dev) ───────────────────────

export class MemoryCredentialStore implements CredentialStore {
  constructor(private credentials: Credential[]) {}

  async findByRef(ref: string): Promise<Credential | null> {
    return this.credentials.find((c) => c.ref === ref) ?? null;
  }

  async listActive(): Promise<Credential[]> {
    return this.credentials.filter((c) => c.status === 'active');
  }

  async listByKind(kind: Credential['kind']): Promise<Credential[]> {
    return this.credentials.filter((c) => c.kind === kind);
  }
}

// ─── CredentialRouter ────────────────────────────────────────────────────────

export class CredentialRouter {
  constructor(
    private store: CredentialStore,
    private rules: RoutingRule[],
    private logger?: AuditLogger
  ) {}

  /**
   * Resolve the correct credential for an agent request.
   * Returns null if no rule matches or the matched credential is expired/inactive.
   * Rules are scored by priority (highest wins) after all match predicates pass.
   */
  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    // Sort matching rules by priority descending — highest-priority rule wins
    const matching = this.rules
      .filter((r) => this.ruleMatches(r, ctx))
      .sort((a, b) => b.priority - a.priority);

    const rule = matching[0];
    if (!rule) return null;

    // Synchronous resolve from in-memory store (async stores use the API route)
    // For async stores, use the /api/resolve route instead.
    const creds = (this.store as MemoryCredentialStore)['credentials'] as Credential[] | undefined;
    const cred = creds?.find(
      (c) => c.ref === rule.credentialRef && c.status === 'active'
    );
    if (!cred) return null;

    // Finding #7: Reject expired credentials
    const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();
    if (isExpired) return null;

    const resolved: ResolvedCredential = {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
    };

    // Fire-and-forget audit log if logger provided
    if (this.logger) {
      this.logger.log(this.buildAuditEntry(ctx, resolved)).catch(console.error);
    }

    return resolved;
  }

  /**
   * Returns true when all specified match predicates on the rule pass.
   * Omitted predicates match anything.
   */
  private ruleMatches(rule: RoutingRule, ctx: AgentRequestContext): boolean {
    if (rule.matchResourceKind && rule.matchResourceKind !== ctx.resourceKind) return false;
    if (rule.matchProvider && rule.matchProvider !== ctx.provider) return false;
    if (rule.matchUserId && rule.matchUserId !== ctx.userId) return false;
    if (rule.matchAction) {
      const actions = Array.isArray(rule.matchAction)
        ? rule.matchAction
        : [rule.matchAction];
      if (!actions.includes(ctx.action)) return false;
    }
    return true;
  }

  /**
   * Build a typed AuditLogEntry — includes traceId for cross-request correlation.
   */
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

  /** @deprecated Use the typed buildAuditEntry instead. Kept for backward compat. */
  auditEntry(
    ctx: AgentRequestContext,
    resolved: ResolvedCredential
  ): Record<string, unknown> {
    return this.buildAuditEntry(ctx, resolved) as Record<string, unknown>;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build a router from a plain credential array (wraps in MemoryCredentialStore).
 * For production, pass a real CredentialStore implementation.
 */
export function createRouter(
  credentials: import('./types').Credential[],
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter(new MemoryCredentialStore(credentials), rules, logger);
}

/**
 * Build a router directly from a CredentialStore interface (production use).
 */
export function createRouterFromStore(
  store: CredentialStore,
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter(store, rules, logger);
}
