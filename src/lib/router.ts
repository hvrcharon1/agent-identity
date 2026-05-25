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
 * - Migration: matchPhase matching, readOnly scope guard, resolvePair()
 */

import type {
  AgentRequestContext,
  AuditLogEntry,
  AuditLogger,
  Credential,
  CredentialStore,
  MigrationContext,
  ResolvedCredential,
  ResolvedCredentialPair,
  RoutingRule,
} from './types';

// ─── In-memory CredentialStore (default for local dev) ────────────────────────

export class MemoryCredentialStore implements CredentialStore {
  private readonly creds: Credential[];
  /** migrationId → Set of reserved refs */
  private readonly reservations = new Map<string, { migrationId: string; expiresAt: number }>();

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

  /**
   * Reserve a credential ref for exclusive use during a migration window.
   * Returns false if already reserved by a different migration (or TTL not expired).
   */
  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const existing = this.reservations.get(ref);
    const now = Date.now();
    if (existing && existing.migrationId !== migrationId && existing.expiresAt > now) {
      return false; // held by another migration that hasn't expired
    }
    this.reservations.set(ref, { migrationId, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  /**
   * Release a reservation. Call in the finally block of a migration run.
   */
  async release(ref: string, migrationId: string): Promise<void> {
    const existing = this.reservations.get(ref);
    if (existing?.migrationId === migrationId) {
      this.reservations.delete(ref);
    }
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

    // readOnly guard: reject credentials whose scope does not include 'read'
    if (rule.readOnly && !cred.scope.toLowerCase().includes('read')) {
      console.warn(
        `[CredentialRouter] Rule "${rule.id}" requires readOnly but credential "${cred.ref}" scope "${cred.scope}" does not include 'read'.`
      );
      return null;
    }

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

  /**
   * Migration: resolve both source (read) and target (write) credentials in one call.
   * The router internally issues two resolve() calls with overridden resourceId and action,
   * tying them to the same migrationId in the returned pair.
   *
   * Returns null if either credential cannot be resolved (missing rule, expired, readOnly violation).
   */
  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null {
    // Resolve source: override resourceId + force read action
    const sourceCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.sourceResourceId,
      action: 'read',
    };

    // Resolve target: override resourceId + use original action (write / load)
    const targetCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.targetResourceId,
      // dry-run forces read on target too — no writes allowed
      action: ctx.dryRun ? 'read' : ctx.action,
    };

    const source = this.resolve(sourceCtx);
    const target = this.resolve(targetCtx);

    if (!source || !target) return null;

    // Compute earliest expiry from the two resolved credentials
    const resolveExpiry = async (): Promise<string | undefined> => {
      const sourceCred = await this.store.findByRef(source.ref);
      const targetCred = await this.store.findByRef(target.ref);
      const expiries = [sourceCred?.expiresAt, targetCred?.expiresAt].filter(Boolean) as string[];
      if (expiries.length === 0) return undefined;
      return expiries.sort()[0]; // earliest
    };

    // Fire-and-forget expiry calculation — caller should await expiresAt if needed
    let expiresAt: string | undefined;
    resolveExpiry().then((v) => { expiresAt = v; }).catch(() => undefined);

    return { source, target, migrationId: ctx.migrationId, expiresAt };
  }

  private ruleMatches(rule: RoutingRule, ctx: AgentRequestContext): boolean {
    if (rule.matchResourceKind && rule.matchResourceKind !== ctx.resourceKind) return false;
    if (rule.matchProvider && rule.matchProvider !== ctx.provider) return false;
    if (rule.matchUserId && rule.matchUserId !== ctx.userId) return false;
    if (rule.matchAction) {
      const actions = Array.isArray(rule.matchAction) ? rule.matchAction : [rule.matchAction];
      if (!actions.includes(ctx.action)) return false;
    }
    // Migration phase matching
    if (rule.matchPhase) {
      const migCtx = ctx as MigrationContext;
      if (!migCtx.phase) return false; // not a migration context
      const phases = Array.isArray(rule.matchPhase) ? rule.matchPhase : [rule.matchPhase];
      if (!phases.includes(migCtx.phase)) return false;
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
