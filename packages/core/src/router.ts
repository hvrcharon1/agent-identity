/**
 * Credential Router — core of @datacules/agent-identity.
 *
 * The model/LLM layer never receives raw credentials. The router resolves
 * which credential to use for a given AgentRequestContext based on explicit
 * routing rules with priority scoring and multi-field matching.
 *
 * Key design decisions:
 * - Duck-type check (isSyncCapable) instead of instanceof for vitest compat
 * - resolvePair() for migration workflows needing source + target creds
 * - Optional AuditLogger injected at construction time
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

interface SyncCapableStore extends CredentialStore {
  findByRefSync(ref: string): Credential | null;
}

function isSyncCapable(store: CredentialStore): store is SyncCapableStore {
  return typeof (store as SyncCapableStore).findByRefSync === 'function';
}

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
    if (existing && existing.migrationId !== migrationId && existing.expiresAt > now) return false;
    this.reservations.set(ref, { migrationId, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  async release(ref: string, migrationId: string): Promise<void> {
    const existing = this.reservations.get(ref);
    if (existing?.migrationId === migrationId) this.reservations.delete(ref);
  }
}

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

    if (!isSyncCapable(this.store)) {
      console.warn('[CredentialRouter] resolve() requires findByRefSync(). Use POST /api/resolve for async stores.');
      return null;
    }

    const cred = this.store.findByRefSync(rule.credentialRef);
    if (!cred) return null;

    if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) return null;

    if (rule.readOnly && !cred.scope.toLowerCase().includes('read')) {
      console.warn(`[CredentialRouter] Rule "${rule.id}" requires readOnly but scope "${cred.scope}" does not include 'read'.`);
      return null;
    }

    const resolved: ResolvedCredential = {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
    };

    if (this.logger) this.logger.log(this.buildAuditEntry(ctx, resolved)).catch(console.error);

    return resolved;
  }

  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null {
    const sourceCtx: AgentRequestContext = { ...ctx, resourceId: ctx.sourceResourceId, action: 'read' };
    const targetCtx: AgentRequestContext = { ...ctx, resourceId: ctx.targetResourceId, action: ctx.dryRun ? 'read' : ctx.action };

    const source = this.resolve(sourceCtx);
    const target = this.resolve(targetCtx);
    if (!source || !target) return null;

    let expiresAt: string | undefined;
    (async () => {
      const [sc, tc] = await Promise.all([this.store.findByRef(source.ref), this.store.findByRef(target.ref)]);
      const expiries = [sc?.expiresAt, tc?.expiresAt].filter(Boolean) as string[];
      if (expiries.length) expiresAt = expiries.sort()[0];
    })().catch(() => undefined);

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
