/**
 * ResolvedCredential decorator — extracts the resolved credential from the
 * request object (set by AgentIdentityGuard) into a controller parameter.
 *
 * Usage:
 *
 *   @Post()
 *   async handler(@ResolvedCredential() cred: ResolvedCredential) {
 *     console.log(cred.resolvedFor);
 *   }
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const RESOLVED_CREDENTIAL_KEY = '__agentIdentityResolved';

export const ResolvedCredential = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return request[RESOLVED_CREDENTIAL_KEY];
  }
);
