import { useCallback } from 'react';
import { useCredentials } from './useCredentials';
import { getAdapter } from '@/lib/providers';
import type { AgentRequestContext } from '@/lib/types';

export function useRouter() {
  const { resolve } = useCredentials();

  const route = useCallback(
    (ctx: AgentRequestContext, request: Record<string, unknown>) => {
      const resolved = resolve(ctx);
      if (!resolved) {
        throw new Error(`No credential resolved for context: ${JSON.stringify(ctx)}`);
      }
      const adapter = getAdapter(ctx.provider);
      const enriched = adapter.injectCredential(request, resolved);
      return { enriched, resolved };
    },
    [resolve]
  );

  return { route };
}
