/**
 * useAgentIdentity — production-safe React hook.
 *
 * Exported from @datacules/agent-identity/react.
 *
 * Unlike useCredentials (demo-only), this hook calls POST /api/resolve
 * server-side. The raw credential never touches the browser.
 *
 * Features:
 *   - Full loading / error / expiresAt lifecycle
 *   - Auto-refresh 60s before credential expiry
 *   - Configurable endpoint (works with custom Next.js routes or the Docker sidecar)
 *   - onError callback for integration with error boundaries / toast systems
 *
 * Usage:
 *   import { useAgentIdentity } from '@datacules/agent-identity/react';
 *
 *   function AiComposer({ userId }: { userId: string }) {
 *     const ctx = {
 *       userId,
 *       resourceId: 'knowledge-base',
 *       resourceKind: 'personal' as const,
 *       provider: 'anthropic' as const,
 *       model: 'claude-sonnet-4-20250514',
 *       action: 'read',
 *       traceId: crypto.randomUUID(),
 *       requestedAt: new Date().toISOString(),
 *     };
 *     const { resolvedFor, loading, error, expiresAt } = useAgentIdentity(ctx);
 *
 *     if (loading) return <p>Resolving credentials…</p>;
 *     if (error)   return <p>Auth error: {error.message}</p>;
 *     return <div>Ready — acting as {resolvedFor}</div>;
 *   }
 */

'use client'; // Next.js App Router compatibility

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentRequestContext } from '../types';

export interface UseAgentIdentityOptions {
  /** Defaults to '/api/resolve' */
  resolveEndpoint?: string;
  /** Re-resolve this many seconds before the credential expires (default: 60) */
  refreshBeforeExpirySeconds?: number;
  /** Called on every error; use for toast / error boundary integration */
  onError?: (err: Error) => void;
  /** Disable auto-refresh on expiry (default: false) */
  disableAutoRefresh?: boolean;
}

export interface AgentIdentityState {
  resolvedFor: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: Error | null;
}

export interface UseAgentIdentityReturn extends AgentIdentityState {
  /** Manually trigger a resolve (called automatically when ctx changes) */
  resolve: (ctx: AgentRequestContext) => Promise<void>;
}

export function useAgentIdentity(
  ctx: AgentRequestContext | null,
  options: UseAgentIdentityOptions = {}
): UseAgentIdentityReturn {
  const {
    resolveEndpoint = '/api/resolve',
    refreshBeforeExpirySeconds = 60,
    onError,
    disableAutoRefresh = false,
  } = options;

  const [state, setState] = useState<AgentIdentityState>({
    resolvedFor: null,
    expiresAt: null,
    loading: false,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const resolve = useCallback(
    async (context: AgentRequestContext): Promise<void> => {
      clearRefreshTimer();
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch(resolveEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(context),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as { resolvedFor: string; expiresAt?: string };

        setState({
          resolvedFor: data.resolvedFor,
          expiresAt: data.expiresAt ?? null,
          loading: false,
          error: null,
        });

        // Schedule auto-refresh before credential expires
        if (!disableAutoRefresh && data.expiresAt) {
          const msUntilRefresh =
            new Date(data.expiresAt).getTime() - Date.now() - refreshBeforeExpirySeconds * 1000;
          if (msUntilRefresh > 0) {
            refreshTimerRef.current = setTimeout(() => resolve(context), msUntilRefresh);
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ ...s, loading: false, error: e }));
        onError?.(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveEndpoint, refreshBeforeExpirySeconds, disableAutoRefresh, onError]
  );

  // Auto-resolve whenever ctx changes
  useEffect(() => {
    if (!ctx) return;
    void resolve(ctx);
    return clearRefreshTimer;
    // ctx is intentionally compared by reference; callers should memoize it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return { ...state, resolve };
}
