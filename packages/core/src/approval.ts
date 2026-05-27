/**
 * Multi-Party Approval Workflows — Feature #5 from FEATURE_SUGGESTIONS.md
 *
 * Intercepts resolve() when a RoutingRule has an ApprovalPolicy, holds
 * resolution pending human sign-off, and fires notifiers.
 */
import type { AgentRequestContext, ApprovalPolicy, ApprovalRequest, ApprovalStatus, AuditLogger } from './types';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ApprovalStore {
  create(request: ApprovalRequest): Promise<void>;
  get(requestId: string): Promise<ApprovalRequest | null>;
  update(requestId: string, status: ApprovalStatus, resolvedBy?: string, justification?: string): Promise<void>;
  listPending(): Promise<ApprovalRequest[]>;
}

export interface ApprovalNotifier {
  notify(request: ApprovalRequest, policy: ApprovalPolicy): Promise<void>;
}

// ─── MemoryApprovalStore ──────────────────────────────────────────────────────

export class MemoryApprovalStore implements ApprovalStore {
  private readonly store = new Map<string, ApprovalRequest>();

  async create(request: ApprovalRequest): Promise<void> {
    this.store.set(request.requestId, { ...request });
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    return this.store.get(requestId) ?? null;
  }

  async update(
    requestId: string,
    status: ApprovalStatus,
    resolvedBy?: string,
    justification?: string
  ): Promise<void> {
    const existing = this.store.get(requestId);
    if (!existing) return;
    this.store.set(requestId, {
      ...existing,
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      justification,
    });
  }

  async listPending(): Promise<ApprovalRequest[]> {
    return Array.from(this.store.values()).filter((r) => r.status === 'pending');
  }
}

// ─── WebhookApprovalNotifier ──────────────────────────────────────────────────

export class WebhookApprovalNotifier implements ApprovalNotifier {
  constructor(private readonly webhookUrl: string, private readonly secret?: string) {}

  async notify(request: ApprovalRequest, _policy: ApprovalPolicy): Promise<void> {
    const body = JSON.stringify(request);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.secret) {
      headers['X-Agent-Identity-Signature'] = this.secret;
    }
    try {
      await fetch(this.webhookUrl, { method: 'POST', headers, body });
    } catch {
      // Notification failure is non-fatal — approval still waits
    }
  }
}

// ─── SlackApprovalNotifier ────────────────────────────────────────────────────

export class SlackApprovalNotifier implements ApprovalNotifier {
  constructor(private readonly webhookUrl: string) {}

  async notify(request: ApprovalRequest, _policy: ApprovalPolicy): Promise<void> {
    const text = [
      `*Approval required* — request \`${request.requestId}\``,
      `User: ${request.context.userId}`,
      `Action: ${request.context.action} on ${request.context.resourceId}`,
      `Credential: ${request.credentialId}`,
      `Expires: ${request.expiresAt}`,
    ].join('\n');
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch {
      // Notification failure is non-fatal
    }
  }
}

// ─── ApprovalManager ─────────────────────────────────────────────────────────

export class ApprovalManager {
  constructor(
    private readonly store: ApprovalStore,
    private readonly notifiers: ApprovalNotifier[] = [],
    private readonly auditLogger?: AuditLogger
  ) {}

  /**
   * Gate a resolve() call behind an approval policy.
   * Returns 'approved' / 'break_glass' if the request was already
   * approved, otherwise creates a new approval request, notifies approvers,
   * and returns 'pending' (the router returns null — caller should retry).
   */
  async request(
    ctx: AgentRequestContext,
    policy: ApprovalPolicy,
    credentialId: string,
    ruleId: string
  ): Promise<ApprovalStatus> {
    // Generate deterministic request ID for idempotency within the same trace
    const requestId = `approval-${ctx.traceId}-${ruleId}`;
    const existing = await this.store.get(requestId);
    if (existing) {
      if (existing.status === 'approved' || existing.status === 'break_glass') {
        return existing.status;
      }
      if (existing.status === 'rejected') return 'rejected';
      // Check timeout
      if (new Date(existing.expiresAt) < new Date()) {
        await this.store.update(requestId, 'timeout');
        if (this.auditLogger) {
          await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            traceId: ctx.traceId,
            userId: ctx.userId,
            action: 'credential.approval_timeout',
            resourceId: ctx.resourceId,
            resourceKind: ctx.resourceKind,
            provider: ctx.provider,
            model: ctx.model,
            credentialId,
            credentialKind: 'fixed',
            resolvedFor: ctx.userId,
          });
        }
        return 'timeout';
      }
      return 'pending';
    }

    // Create new request
    const timeoutSeconds = policy.timeoutSeconds ?? 300;
    const newRequest: ApprovalRequest = {
      requestId,
      credentialId,
      ruleId,
      context: ctx,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
    };
    await this.store.create(newRequest);

    // Notify all approvers
    await Promise.allSettled(this.notifiers.map((n) => n.notify(newRequest, policy)));

    if (this.auditLogger) {
      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        traceId: ctx.traceId,
        userId: ctx.userId,
        action: 'credential.approval_requested',
        resourceId: ctx.resourceId,
        resourceKind: ctx.resourceKind,
        provider: ctx.provider,
        model: ctx.model,
        credentialId,
        credentialKind: 'fixed',
        resolvedFor: ctx.userId,
      });
    }

    return 'pending';
  }
}
