import { useState, useCallback } from 'react';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '@/lib/credentials';
import { createRouter } from '@/lib/router';
import type { AgentRequestContext, ResolvedCredential } from '@/lib/types';

export function useCredentials() {
  const [credentials] = useState(DEFAULT_CREDENTIALS);
  const [rules] = useState(DEFAULT_ROUTING_RULES);

  const resolve = useCallback(
    (ctx: AgentRequestContext): ResolvedCredential | null => {
      const router = createRouter(credentials, rules);
      return router.resolve(ctx);
    },
    [credentials, rules]
  );

  return { credentials, rules, resolve };
}
