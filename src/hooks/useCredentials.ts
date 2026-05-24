/**
 * useCredentials hook — provides credentials, rules, and a resolve function.
 *
 * Finding #10: Router instance is now memoized via useMemo to avoid
 * re-instantiation on every resolve() call.
 *
 * Note (Finding #1): In production, do NOT call resolve() client-side for
 * real credential injection. Use POST /api/resolve instead. This hook is
 * suitable for UI display and educational demos only.
 */
import { useState, useCallback, useMemo } from 'react';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '@/lib/credentials';
import { createRouter } from '@/lib/router';
import type { AgentRequestContext, ResolvedCredential } from '@/lib/types';

export function useCredentials() {
  const [credentials] = useState(DEFAULT_CREDENTIALS);
  const [rules] = useState(DEFAULT_ROUTING_RULES);

  // Finding #10: Memoize router — created once per credential/rule state change,
  // not once per resolve() call.
  const router = useMemo(
    () => createRouter(credentials, rules),
    [credentials, rules]
  );

  const resolve = useCallback(
    (ctx: AgentRequestContext): ResolvedCredential | null => router.resolve(ctx),
    [router]
  );

  return { credentials, rules, resolve };
}
