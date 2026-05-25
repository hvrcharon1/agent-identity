/**
 * AgentIdentityGuard — NestJS CanActivate guard that resolves a credential
 * before the request reaches the controller handler.
 *
 * Reads an AgentRequestContext from the request (via a configurable extractor),
 * resolves the credential, and attaches the result to `request[RESOLVED_CREDENTIAL_KEY]`
 * for consumption by the @ResolvedCredential() decorator.
 *
 * Usage:
 *
 *   @UseGuards(AgentIdentityGuard)
 *   @Post()
 *   async handler(@ResolvedCredential() cred: ResolvedCredentialType) { ... }
 *
 * By default the guard reads the AgentRequestContext from `request.body.agentCtx`.
 * Customise by extending the guard and overriding extractContext().
 *
 * Example custom guard:
 *
 *   @Injectable()
 *   export class MyGuard extends AgentIdentityGuard {
 *     protected extractContext(req: Request): AgentRequestContext {
 *       return buildCtxFromHeaders(req.headers);
 *     }
 *   }
 */
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import type { AgentRequestContext } from '@datacules/agent-identity';
import { AgentIdentityService } from './AgentIdentityService';
import { RESOLVED_CREDENTIAL_KEY } from './ResolvedCredential';

@Injectable()
export class AgentIdentityGuard implements CanActivate {
  constructor(protected readonly agentIdentityService: AgentIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const ctx = this.extractContext(request);
    const resolved = await this.agentIdentityService.resolveAsync(ctx);

    if (!resolved) {
      throw new ForbiddenException('No credential resolved for this request context');
    }

    // Attach for @ResolvedCredential() param decorator
    request[RESOLVED_CREDENTIAL_KEY] = resolved;
    return true;
  }

  /**
   * Override this method to change how the AgentRequestContext is extracted
   * from the incoming HTTP request. Default: reads from request.body.agentCtx.
   */
  protected extractContext(request: Record<string, unknown>): AgentRequestContext {
    const body = request['body'] as Record<string, unknown> | undefined;
    const ctx = body?.['agentCtx'];
    if (!ctx || typeof ctx !== 'object') {
      throw new ForbiddenException(
        'Missing agentCtx in request body. Override AgentIdentityGuard.extractContext() ' +
          'to customise how the context is read from the request.'
      );
    }
    return ctx as AgentRequestContext;
  }
}
