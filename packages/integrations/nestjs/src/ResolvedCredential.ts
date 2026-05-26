/**
 * Parameter decorator that extracts the resolved credential from the request.
 *
 * Requires AgentIdentityGuard (or a subclass) to have run before the handler.
 *
 * Usage:
 *   @Post('complete')
 *   @UseGuards(AgentIdentityGuard)
 *   async complete(
 *     @ResolvedCredential() cred: ResolvedCredential,
 *     @Body() body: CompleteDto
 *   ) {
 *     // cred is fully typed as ResolvedCredential
 *   }
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RESOLVED_CREDENTIAL_KEY } from './AgentIdentityGuard';

export const ResolvedCredential = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return request[RESOLVED_CREDENTIAL_KEY] ?? null;
  }
);
