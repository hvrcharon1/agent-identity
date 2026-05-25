/**
 * AgentIdentityService — NestJS Injectable service wrapping CredentialRouter.
 *
 * Registers as a singleton in your module. Provides resolve() and
 * resolveAsync() for use in controllers, guards, interceptors, and pipes.
 *
 * Usage in a module:
 *
 *   import { AgentIdentityModule } from '@datacules/agent-identity-nestjs';
 *
 *   @Module({
 *     imports: [
 *       AgentIdentityModule.forRoot({
 *         credentials: [...],
 *         rules: [...],
 *         logger: new ConsoleAuditLogger(),  // optional
 *       }),
 *     ],
 *   })
 *   export class AppModule {}
 *
 * Usage in a controller:
 *
 *   @Controller('chat')
 *   export class ChatController {
 *     constructor(private readonly agentIdentity: AgentIdentityService) {}
 *
 *     @Post()
 *     async chat(@Body() body: ChatDto) {
 *       const resolved = await this.agentIdentity.resolveAsync({
 *         userId: body.userId, ...
 *       });
 *       // use resolved.resolvedFor to tag downstream request
 *     }
 *   }
 */
import { Injectable } from '@nestjs/common';
import {
  CredentialRouter,
  createRouter,
  createRouterFromStore,
} from '@datacules/agent-identity';
import type {
  AgentRequestContext,
  AuditLogger,
  Credential,
  CredentialStore,
  MigrationContext,
  ResolvedCredential,
  ResolvedCredentialPair,
  RoutingRule,
} from '@datacules/agent-identity';

export interface AgentIdentityModuleOptions {
  /** Inline credentials array. Mutually exclusive with `store`. */
  credentials?: Credential[];
  /** Async credential store. Mutually exclusive with `credentials`. */
  store?: CredentialStore;
  rules: RoutingRule[];
  logger?: AuditLogger;
}

@Injectable()
export class AgentIdentityService {
  private readonly router: CredentialRouter;

  constructor(options: AgentIdentityModuleOptions) {
    if (options.store) {
      this.router = createRouterFromStore(options.store, options.rules, options.logger);
    } else {
      this.router = createRouter(options.credentials ?? [], options.rules, options.logger);
    }
  }

  /** Synchronous resolution — only works with MemoryCredentialStore. */
  resolve(ctx: AgentRequestContext): ResolvedCredential | null {
    return this.router.resolve(ctx);
  }

  /** Async resolution — works with any CredentialStore. */
  async resolveAsync(ctx: AgentRequestContext): Promise<ResolvedCredential | null> {
    return this.router.resolveAsync(ctx);
  }

  /** Resolve both source and target credentials for a migration (async). */
  async resolvePairAsync(ctx: MigrationContext): Promise<ResolvedCredentialPair | null> {
    return this.router.resolvePairAsync(ctx);
  }

  /** Expose the underlying router for advanced use-cases. */
  getRouter(): CredentialRouter {
    return this.router;
  }
}
