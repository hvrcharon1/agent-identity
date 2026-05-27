/**
 * Multi-Party Approval Workflows — @datacules/agent-identity core
 *
 * High-risk routing rules can require explicit human approval before a
 * credential resolves. The router returns PENDING_APPROVAL and a requestId.
 * Approvers are notified via registered ApprovalNotifiers. On approval the
 * credential resolves normally; on timeout or rejection it returns null.
 */
import type { ApprovalRequest, ApprovalPolicy, ApprovalStatus, AgentRequestContext } from './types';

// ─── Approval Store ──────────────────────────────────────────────────────────

export interface ApprovalStore {
  create(request: ApprovalRequest): Promise<void>;
  findById(requestId: string): Promise<ApprovalRequest | null>;
  update(requestId: string, patch: Partial<ApprovalRequest>): Promise<void>;
  listPending(): Promise<ApprovalRequest[]>;
}

export class MemoryApprovalStore implements ApprovalStore {
  private readonly requests = new Map<string, ApprovalRequest>();

  async create(request: ApprovalRequest): Promise<void> {
    this.requests.set(request.requestId, { ...request });
  }

  async findById(requestId: string): Promise<ApprovalRequest | null> {
    return this.requests.get(requestId) ?? null;
  }

  async update(requestId: string, patch: Partial<ApprovalRequest>): Promise<void> {
    const existing = this.requests.get(requestId);
    if (existing) this.requests.set(requestId, { ...existing, ...patch });
  }

  async listPending(): Promise<ApprovalRequest[]> {
    return Array.from(this.requests.values()).filter((r) => r.status === 'pending');
  }
}

// ─── Approval Notifier ───────────────────────────────────────────────────────

export interface ApprovalNotifier {
  notify(request: ApprovalRequest): Promise<void>;
}

export class WebhookApprovalNotifier implements ApprovalNotifier {
  constructor(private readonly url: string, private readonly secret?: string) {}

  async notify(request: ApprovalRequest): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.secret) headers['X-Approval-Secret'] = this.secret;
    await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    }).catch((err) => console.warn('[ApprovalNotifier] webhook failed:', err));
  }
}

export class SlackApprovalNotifier implements ApprovalNotifier {
  constructor(private readonly webhookUrl: string) {}

  async notify(request: ApprovalRequest): Promise<void> {
    const ctx = request.context;
    const text = [
      `*Agent Identity — Approval Required*`,
      `*Credential:* \`${request.credentialId}\``,
      `*Action:* \`${ctx.action}\` on \`${ctx.resourceId}\` (${ctx.resourceKind})`,
      `*Requested by:* \`${ctx.userId}\``,
      `*Provider:* ${ctx.provider} / ${ctx.model}`,
      `*TraceId:* \`${ctx.traceId}\``,
      `*Expires:* ${request.expiresAt}`,
      `*Request ID:* \`${request.requestId}\``,
    ].join('\n');

    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch((err) => console.warn('[SlackApprovalNotifier] failed:', err));
  }
}

// ─── Approval Manager ────────────────────────────────────────────────────────

export interface ApprovalManagerConfig {
  store: ApprovalStore;
  notifiers: ApprovalNotifier[];
  onApproved?: (request: ApprovalRequest) => void;
  onRejected?: (request: ApprovalRequest) => void;
}

export class ApprovalManager {
  private pendingCallbacks = new Map<string, {
    resolve: (status: ApprovalStatus) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly config: ApprovalManagerConfig) {}

  /**
   * Request approval for a credential resolution.
   * Returns a promise that resolves to the final ApprovalStatus.
   * Callers should await this before resolving the credential.
   */
  async request(
    ctx: AgentRequestContext,
    policy: ApprovalPolicy,
    credentialId: string,
    ruleId: string
  ): Promise<ApprovalStatus> {
    const requestId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeoutSeconds = policy.timeoutSeconds ?? 300;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

    const request: ApprovalRequest = {
      requestId,
      credentialId,
      ruleId,
      context: ctx,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt,
    };

    await this.config.store.create(request);
    await Promise.allSettled(this.config.notifiers.map((n) => n.notify(request)));

    return new Promise<ApprovalStatus>((resolve) => {
      const timer = setTimeout(async () => {
        this.pendingCallbacks.delete(requestId);
        await this.config.store.update(requestId, { status: 'timeout', resolvedAt: new Date().toISOString() });
        this.config.onRejected?.({ ...request, status: 'timeout' });
        resolve('timeout');
      }, timeoutSeconds * 1000);

      this.pendingCallbacks.set(requestId, { resolve, timer });
    });
  }

  /** Called by your approval endpoint when an approver acts */
  async respond(
    requestId: string,
    decision: 'approved' | 'rejected',
    resolvedBy: string,
    justification?: string
  ): Promise<boolean> {
    const cb = this.pendingCallbacks.get(requestId);
    if (!cb) return false;

    clearTimeout(cb.timer);
    this.pendingCallbacks.delete(requestId);

    const patch: Partial<ApprovalRequest> = {
      status: decision,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      justification,
    };
    await this.config.store.update(requestId, patch);

    const request = await this.config.store.findById(requestId);
    if (decision === 'approved') this.config.onApproved?.(request!);
    else this.config.onRejected?.(request!);

    cb.resolve(decision);
    return true;
  }

  /** Break-glass: emergency override, always logged as non-deletable */
  async breakGlass(
    requestId: string,
    approver: string,
    justification: string
  ): Promise<boolean> {
    const cb = this.pendingCallbacks.get(requestId);
    if (!cb) return false;
    clearTimeout(cb.timer);
    this.pendingCallbacks.delete(requestId);
    await this.config.store.update(requestId, {
      status: 'break_glass',
      resolvedAt: new Date().toISOString(),
      resolvedBy: approver,
      justification: `[BREAK-GLASS] ${justification}`,
    });
    cb.resolve('break_glass');
    return true;
  }
}
