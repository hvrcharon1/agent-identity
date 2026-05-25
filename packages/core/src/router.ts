/**
 * Credential Router — core publishable package.
 * Identical logic to src/lib/router.ts; imports resolved from the package itself.
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

// ─── In-memory CredentialStore ────────────────────────────────────────────────

export class MemoryCredentialStore implements CredentialStore {
  private readonly creds: Credential[];
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

  async reserve(ref: string, migrationId: string, ttlSeconds: number): Promise<boolean> {
    const existing = this.reservations.get(ref);
    const now = Date.now();
    if (existing && existing.migrationId !== migrationId && existing.expiresAt > now) {
      return false;
    }
    this.reservations.set(ref, { migrationId, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

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
          'Use resolveAsync() or POST /api/resolve for async credential stores.'
      );
      return null;
    }

    const cred = this.store.findByRefSync(rule.credentialRef);
    if (!cred) return null;

    const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();
    if (isExpired) return null;

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
   * Async resolve — works with any CredentialStore, not just MemoryCredentialStore.
   * Prefer this for production stores (Vault, AWS, Azure).
   */
  async resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null> {
    const matching = this.rules
      .filter((r) => this.ruleMatches(r, ctx))
      .sort((a, b) => b.priority - a.priority);

    const rule = matching[0];
    if (!rule) return null;

    const cred = await this.store.findByRef(rule.credentialRef);
    if (!cred) return null;

    const isExpired = cred.expiresAt && new Date(cred.expiresAt) < new Date();
    if (isExpired) return null;

    if (rule.readOnly && !cred.scope.toLowerCase().includes('read')) return null;

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

  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null {
    const sourceCtx: AgentRequestContext = { ...ctx, resourceId: ctx.sourceResourceId, action: 'read' };
    const targetCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.targetResourceId,
      action: ctx.dryRun ? 'read' : ctx.action,
    };

    const source = this.resolve(sourceCtx);
    const target = this.resolve(targetCtx);
    if (!source || !target) return null;

    let expiresAt: string | undefined;
    this.store
      .findByRef(source.ref)
      .then(async (s) => {
        const t = await this.store.findByRef(target.ref);
        const expiries = [s?.expiresAt, t?.expiresAt].filter(Boolean) as string[];
        if (expiries.length) expiresAt = expiries.sort()[0];
      })
      .catch(() => undefined);

    return { source, target, migrationId: ctx.migrationId, expiresAt };
  }

  async resolvePairAsync(ctx: MigrationContext): Promise<ResolvedCredentialPair | null> {
    const sourceCtx: AgentRequestContext = { ...ctx, resourceId: ctx.sourceResourceId, action: 'read' };
    const targetCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.targetResourceId,
      action: ctx.dryRun ? 'read' : ctx.action,
    };

    const [source, target] = await Promise.all([
      this.resolveAsync(sourceCtx),
      this.resolveAsync(targetCtx),
    ]);
    if (!source || !target) return null;

    const [sourceCred, targetCred] = await Promise.all([
      this.store.findByRef(source.ref),
      this.store.findByRef(target.ref),
    ]);
    const expiries = [sourceCred?.expiresAt, targetCred?.expiresAt].filter(Boolean) as string[];
    const expiresAt = expiries.length ? expiries.sort()[0] : undefined;

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
    if (rule.matchPhase) {
      const migCtx = ctx as MigrationContext;
      if (!migCtx.phase) return false;
      const phases = Array.isArray(rule.matchPhase) ? rule.matchPhase : [rule.matchPhase];
      if (!phases.includes(migCtx.phase)) return false;
    }
    return true;
  }

  private buildAuditEntry(ctx: AgentRequestContext, resolved: ResolvedCredential): AuditLogEntry {
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
