/**
 * NestJS guard that resolves agent credentials before the route handler runs.
 *
 * The guard attaches the resolved credential to request.resolvedCredential.
 * Use @ResolvedCredential() in the route handler to access it.
 *
 * Usage:
 *   // Apply globally:
 *   app.useGlobalGuards(new AgentIdentityGuard(agentIdentityService));
 *
 *   // Apply per-controller:
 *   @UseGuards(AgentIdentityGuard)
 *   @Controller('ai')
 *   export class AiController {}
 *
 *   // Apply per-route:
 *   @UseGuards(AgentIdentityGuard)
 *   @Post('complete')
 *   async complete(@ResolvedCredential() cred: ResolvedCredential) { ... }
 *
 * Override extractContext() to customise how the AgentRequestContext
 * is read from the incoming request:
 *
 *   @Injectable()
 *   class MyGuard extends AgentIdentityGuard {
 *     extractContext(request: Record<string, unknown>) {
 *       return request.headers['x-agent-context']
 *         ? JSON.parse(request.headers['x-agent-context'] as string)
 *         : null;
 *     }
 *   }
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AgentRequestContext, ResolvedCredential } from '@datacules/agent-identity';
import { AgentIdentityService } from './AgentIdentityService';

export const RESOLVED_CREDENTIAL_KEY = '__resolvedCredential';

@Injectable()
export class AgentIdentityGuard implements CanActivate {
  constructor(protected readonly service: AgentIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const ctx = this.extractContext(request);

    if (!ctx) {
      // No agent context on this request — allow through (non-agent routes)
      return true;
    }

    const resolved: ResolvedCredential | null = await this.service.resolveAsync(ctx);

    if (!resolved) {
      throw new ForbiddenException(
        'agent-identity: no credential matched this request context'
      );
    }

    // Attach so @ResolvedCredential() and downstream handlers can read it
    (request as Record<string, unknown>)[RESOLVED_CREDENTIAL_KEY] = resolved;
    return true;
  }

  /**
   * Override to customise context extraction.
   * Default: reads ctx from request.body.agentContext
   */
  protected extractContext(
    request: Record<string, unknown>
  ): AgentRequestContext | null {
    const body = request['body'] as Record<string, unknown> | undefined;
    const ctx = body?.['agentContext'];
    if (!ctx || typeof ctx !== 'object') return null;
    return ctx as AgentRequestContext;
  }
}
