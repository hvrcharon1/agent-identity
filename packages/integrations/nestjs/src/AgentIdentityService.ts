/**
 * Injectable service wrapping CredentialRouter.
 *
 * Usage in any NestJS provider or controller:
 *
 *   constructor(private readonly agentIdentity: AgentIdentityService) {}
 *
 *   async handleRequest(ctx: AgentRequestContext) {
 *     const resolved = this.agentIdentity.resolve(ctx);
 *     if (!resolved) throw new ForbiddenException('No credential resolved');
 *     // ...
 *   }
 */
import { Injectable, Inject } from '@nestjs/common';
import { createRouter } from '@datacules/agent-identity';
import type {
  AgentRequestContext,
  MigrationContext,
  ResolvedCredential,
  ResolvedCredentialPair,
} from '@datacules/agent-identity';
import { AGENT_IDENTITY_OPTIONS } from './AgentIdentityModule';
import type { AgentIdentityModuleOptions } from './AgentIdentityModule';

@Injectable()
export class AgentIdentityService {
  private readonly router: ReturnType<typeof createRouter>;

  constructor(
    @Inject(AGENT_IDENTITY_OPTIONS)
    private readonly options: AgentIdentityModuleOptions
  ) {
    this.router = createRouter(
      options.credentials,
      options.rules,
      options.logger
    );
  }

  /** Synchronous resolve — returns null if no rule matches. */
  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    return this.router.resolve(ctx);
  }

  /** Async resolve — awaits store lookup when a CredentialStore is wired. */
  async resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null> {
    return this.router.resolveAsync(ctx);
  }

  /** Async paired resolve for migration workflows. */
  async resolvePairAsync(
    ctx: MigrationContext
  ): Promise<ResolvedCredentialPair | null> {
    return this.router.resolvePairAsync(ctx);
  }
}
