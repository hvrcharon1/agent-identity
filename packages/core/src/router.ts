/**
 * Credential Router — core of @datacules/agent-identity.
 *
 * Key features:
 * - Canary routing: canaryRef + canaryWeight on RoutingRule
 * - Attestation: optional AttestationSigner on router config
 * - Budget enforcement: BudgetEnforcer check before resolving
 * - Approval gate: ApprovalManager integration on rules with approval policy
 * - resolveAsync(): full async resolution path for cloud stores
 * - resolvePairAsync(): async migration pair resolution (async counterpart
 *   of resolvePair(), enabling budget + attestation on migration workflows)
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
  AttestationSigner,
} from './types';
import { buildAttestation } from './attestation';
import type { BudgetEnforcer } from './budget';
import type { ApprovalManager } from './approval';

interface SyncCapableStore extends CredentialStore {
  findByRefSync(ref: string): Credential | null;
}

function isSyncCapable(store: CredentialStore): store is SyncCapableStore {
  return typeof (store as SyncCapableStore).findByRefSync === 'function';
}

export interface RouterConfig {
  store: CredentialStore;
  rules: RoutingRule[];
  logger?: AuditLogger;
  /** Sign a JWT attestation and attach it to every ResolvedCredential */
  attestationSigner?: AttestationSigner;
  /** Enforce per-credential budget limits */
  budgetEnforcer?: BudgetEnforcer;
  /** Gate high-risk resolutions behind human approval */
  approvalManager?: ApprovalManager;
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
  constructor(private readonly config: RouterConfig) {}

  // ─── Sync resolve (requires SyncCapable store) ────────────────────────────

  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    const { store, rules } = this.config;
    const matching = rules
      .filter((r) => this.ruleMatches(r, ctx))
      .sort((a, b) => b.priority - a.priority);

    const rule = matching[0];
    if (!rule) return null;

    if (!isSyncCapable(store)) {
      console.warn('[CredentialRouter] resolve() requires findByRefSync(). Use resolveAsync() for async stores.');
      return null;
    }

    const ref = this.selectRef(rule);
    const isCanary = ref === rule.canaryRef;

    const cred = store.findByRefSync(ref);
    if (!cred) return null;
    if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) return null;
    if (rule.readOnly && !cred.scope.toLowerCase().includes('read')) return null;

    const resolved: ResolvedCredential = {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
      expiresAt: cred.expiresAt,
      isCanary,
    };

    if (this.config.logger) {
      const entry = this.buildAuditEntry(ctx, resolved, rule, isCanary);
      Promise.resolve(this.config.logger.log(entry)).catch(console.error);
    }

    return resolved;
  }

  // ─── Async resolve (all stores; supports approval + budget + attestation) ─

  async resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null> {
    const { store, rules, approvalManager, budgetEnforcer, attestationSigner } = this.config;
    const matching = rules
      .filter((r) => this.ruleMatches(r, ctx))
      .sort((a, b) => b.priority - a.priority);

    const rule = matching[0];
    if (!rule) return null;

    // Approval gate
    if (rule.approval && approvalManager) {
      const status = await approvalManager.request(ctx, rule.approval, rule.credentialRef, rule.id);
      if (status !== 'approved' && status !== 'break_glass') return null;
    }

    const ref = this.selectRef(rule);
    const isCanary = ref === rule.canaryRef;

    const cred = await store.findByRef(ref);
    if (!cred) return null;
    if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) return null;
    if (rule.readOnly && !cred.scope.toLowerCase().includes('read')) return null;

    // Budget check
    if (budgetEnforcer) {
      const budget = await budgetEnforcer.check(cred);
      if (!budget.allowed) return null;
    }

    const resolved: ResolvedCredential = {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
      expiresAt: cred.expiresAt,
      isCanary,
    };

    // Attestation
    if (attestationSigner) {
      resolved.credentialAttestation = await buildAttestation(ctx, resolved, {
        signer: attestationSigner,
        ruleId: rule.id,
      });
    }

    if (this.config.logger) {
      await this.config.logger.log(this.buildAuditEntry(ctx, resolved, rule, isCanary));
    }

    return resolved;
  }

  // ─── Pair resolve for migration (sync) ───────────────────────────────────

  resolvePair(ctx: MigrationContext): ResolvedCredentialPair | null {
    const sourceCtx: AgentRequestContext = { ...ctx, resourceId: ctx.sourceResourceId, action: 'read' };
    const targetCtx: AgentRequestContext = { ...ctx, resourceId: ctx.targetResourceId, action: ctx.dryRun ? 'read' : ctx.action };

    const source = this.resolve(sourceCtx);
    const target = this.resolve(targetCtx);
    if (!source || !target) return null;

    return { source, target, migrationId: ctx.migrationId };
  }

  // ─── Pair resolve for migration (async) ──────────────────────────────────

  /**
   * Async counterpart of resolvePair(). Resolves source and target credentials
   * in parallel using resolveAsync(), so both resolutions benefit from:
   *   - Budget enforcement (per-credential checks)
   *   - Attestation signing (if AttestationSigner is configured)
   *   - Approval gates (if ApprovalManager is configured)
   *   - Cloud credential stores (AWS Secrets Manager, Vault, Azure Key Vault)
   *
   * Use this instead of resolvePair() in any production migration workflow
   * that uses a non-MemoryCredentialStore.
   *
   * The source context always uses action: 'read'.
   * The target context uses action: 'read' when dryRun is true, otherwise
   * the original action from the MigrationContext.
   *
   * Returns null if either source or target credential cannot be resolved.
   */
  async resolvePairAsync(ctx: MigrationContext): Promise<ResolvedCredentialPair | null> {
    const sourceCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.sourceResourceId,
      action: 'read',
    };
    const targetCtx: AgentRequestContext = {
      ...ctx,
      resourceId: ctx.targetResourceId,
      action: ctx.dryRun ? 'read' : ctx.action,
    };

    // Resolve both in parallel — independent credentials, no ordering dependency
    const [source, target] = await Promise.all([
      this.resolveAsync(sourceCtx),
      this.resolveAsync(targetCtx),
    ]);

    if (!source || !target) return null;

    // expiresAt on the pair is the earlier of the two expiries
    let expiresAt: string | undefined;
    if (source.expiresAt && target.expiresAt) {
      expiresAt = source.expiresAt < target.expiresAt ? source.expiresAt : target.expiresAt;
    } else {
      expiresAt = source.expiresAt ?? target.expiresAt;
    }

    return { source, target, migrationId: ctx.migrationId, expiresAt };
  }

  // ─── Canary selection ─────────────────────────────────────────────────────

  private selectRef(rule: RoutingRule): string {
    if (rule.canaryRef && rule.canaryWeight && rule.canaryWeight > 0) {
      const roll = Math.random() * 100;
      if (roll < rule.canaryWeight) return rule.canaryRef;
    }
    return rule.credentialRef;
  }

  // ─── Rule matching ────────────────────────────────────────────────────────

  private ruleMatches(rule: RoutingRule, ctx: AgentRequestContext): boolean {
    if (rule.matchResourceKind && rule.matchResourceKind !== ctx.resourceKind) return false;
    if (rule.matchProvider && rule.matchProvider !== ctx.provider) return false;
    if (rule.matchUserId && rule.matchUserId !== ctx.userId) return false;
    if (rule.matchSpiffeId && ctx.spiffeId !== rule.matchSpiffeId) return false;
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

  // ─── Audit entry builder ─────────────────────────────────────────────────

  private buildAuditEntry(
    ctx: AgentRequestContext,
    resolved: ResolvedCredential,
    rule: RoutingRule,
    isCanary: boolean
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
      isCanary,
      spiffeId: ctx.spiffeId,
    };
  }
}

// ─── Factory functions ────────────────────────────────────────────────────────

export function createRouter(
  credentials: Credential[],
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter({ store: new MemoryCredentialStore(credentials), rules, logger });
}

export function createRouterFromStore(
  store: CredentialStore,
  rules: RoutingRule[],
  logger?: AuditLogger
): CredentialRouter {
  return new CredentialRouter({ store, rules, logger });
}

export function createRouterWithConfig(config: RouterConfig): CredentialRouter {
  return new CredentialRouter(config);
}
