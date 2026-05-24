/**
 * Credential Router
 *
 * Resolves which credential an agent should use for a given request.
 * The model/LLM layer never receives raw credentials — the router
 * injects them at call time based on explicit routing rules.
 */

import type {
  AgentRequestContext,
  Credential,
  ResolvedCredential,
  RoutingRule,
} from './types';

export class CredentialRouter {
  constructor(
    private credentials: Credential[],
    private rules: RoutingRule[]
  ) {}

  /**
   * Resolve the correct credential for an agent request.
   * Returns null if no rule matches (caller should deny the request).
   */
  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    // Find the first rule that matches the resource kind
    const rule = this.rules.find((r) => r.resourceKind === ctx.resourceKind);
    if (!rule) return null;

    // Find the matching credential
    const cred = this.credentials.find(
      (c) => c.ref === rule.credentialRef && c.status === 'active'
    );
    if (!cred) return null;

    return {
      credentialId: cred.id,
      kind: cred.kind,
      ref: cred.ref,
      resolvedFor: cred.kind === 'user-delegated' ? ctx.userId : 'service',
    };
  }

  /**
   * Audit log entry for a resolved credential.
   * In production, write this to an append-only audit log.
   */
  auditEntry(
    ctx: AgentRequestContext,
    resolved: ResolvedCredential
  ): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
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

/**
 * Factory: build a router from a credential store and rule set.
 */
export function createRouter(
  credentials: Credential[],
  rules: RoutingRule[]
): CredentialRouter {
  return new CredentialRouter(credentials, rules);
}
