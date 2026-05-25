/**
 * Production-safe useAgentIdentity React hook (Task 8).
 *
 * Calls /api/resolve over HTTP — never touches a raw credential.
 * Manages loading, error, and expiry states with optional auto-refresh
 * before the credential expires.
 *
 * Usage:
 *   import { useAgentIdentity } from '@datacules/agent-identity/react';
 *
 *   const { resolvedFor, loading, error, expiresAt } = useAgentIdentity(ctx);
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentRequestContext, MigrationContext } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAgentIdentityOptions {
  /** Defaults to '/api/resolve' */
  resolveEndpoint?: string;
  /** Defaults to '/api/migrate/resolve' */
  migrateResolveEndpoint?: string;
  /** Called whenever a resolve attempt fails */
  onError?: (err: Error) => void;
  /**
   * When true, schedules an auto-refresh 60 s before the credential's expiresAt.
   * Defaults to true.
   */
  autoRefreshBeforeExpiry?: boolean;
  /**
   * Seconds before expiry at which to schedule the refresh.
   * Defaults to 60.
   */
  refreshLeadSeconds?: number;
}

export interface AgentIdentityState {
  resolvedFor: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: Error | null;
}

export interface MigrationIdentityState {
  sourceResolvedFor: string | null;
  targetResolvedFor: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: Error | null;
}

// ─── useAgentIdentity ─────────────────────────────────────────────────────────

/**
 * Resolves a single credential for the given AgentRequestContext.
 * Re-resolves automatically when `ctx` changes and optionally before expiry.
 */
export function useAgentIdentity(
  ctx: AgentRequestContext | null,
  options: UseAgentIdentityOptions = {}
) {
  const {
    resolveEndpoint = '/api/resolve',
    autoRefreshBeforeExpiry = true,
    refreshLeadSeconds = 60,
    onError,
  } = options;

  const [state, setState] = useState<AgentIdentityState>({
    resolvedFor: null,
    expiresAt: null,
    loading: false,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolve = useCallback(
    async (context: AgentRequestContext) => {
      setState((s) => ({ ...s, loading: true, error: null }));

      // Clear any pending refresh timer
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

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

        const data = (await res.json()) as { resolvedFor: string; expiresAt?: string };
        setState({
          resolvedFor: data.resolvedFor,
          expiresAt: data.expiresAt ?? null,
          loading: false,
          error: null,
        });

        // Schedule auto-refresh before credential expires
        if (autoRefreshBeforeExpiry && data.expiresAt) {
          const msUntilRefresh =
            new Date(data.expiresAt).getTime() - Date.now() - refreshLeadSeconds * 1_000;
          if (msUntilRefresh > 0) {
            refreshTimerRef.current = setTimeout(() => resolve(context), msUntilRefresh);
          }
        }

        return data;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ ...s, loading: false, error: e }));
        onError?.(e);
        return null;
      }
    },
    [resolveEndpoint, autoRefreshBeforeExpiry, refreshLeadSeconds, onError]
  );

  // Auto-resolve when ctx changes
  useEffect(() => {
    if (!ctx) return;
    resolve(ctx);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [ctx, resolve]);

  return { ...state, resolve };
}

// ─── useMigrationIdentity ─────────────────────────────────────────────────────

/**
 * Resolves both source and target credentials for a MigrationContext.
 * Uses the /api/migrate/resolve endpoint.
 */
export function useMigrationIdentity(
  ctx: MigrationContext | null,
  options: UseAgentIdentityOptions = {}
) {
  const {
    migrateResolveEndpoint = '/api/migrate/resolve',
    autoRefreshBeforeExpiry = true,
    refreshLeadSeconds = 60,
    onError,
  } = options;

  const [state, setState] = useState<MigrationIdentityState>({
    sourceResolvedFor: null,
    targetResolvedFor: null,
    expiresAt: null,
    loading: false,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolve = useCallback(
    async (context: MigrationContext) => {
      setState((s) => ({ ...s, loading: true, error: null }));

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      try {
        const res = await fetch(migrateResolveEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            migrationId:      context.migrationId,
            phase:            context.phase,
            sourceResourceId: context.sourceResourceId,
            targetResourceId: context.targetResourceId,
            userId:           context.userId,
            provider:         context.provider,
            model:            context.model,
            traceId:          context.traceId,
            dryRun:           context.dryRun,
            batchIndex:       context.batchIndex,
            totalBatches:     context.totalBatches,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          sourceResolvedFor: string;
          targetResolvedFor: string;
          expiresAt?: string;
        };

        setState({
          sourceResolvedFor: data.sourceResolvedFor,
          targetResolvedFor: data.targetResolvedFor,
          expiresAt: data.expiresAt ?? null,
          loading: false,
          error: null,
        });

        if (autoRefreshBeforeExpiry && data.expiresAt) {
          const msUntilRefresh =
            new Date(data.expiresAt).getTime() - Date.now() - refreshLeadSeconds * 1_000;
          if (msUntilRefresh > 0) {
            refreshTimerRef.current = setTimeout(() => resolve(context), msUntilRefresh);
          }
        }

        return data;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ ...s, loading: false, error: e }));
        onError?.(e);
        return null;
      }
    },
    [migrateResolveEndpoint, autoRefreshBeforeExpiry, refreshLeadSeconds, onError]
  );

  useEffect(() => {
    if (!ctx) return;
    resolve(ctx);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [ctx, resolve]);

  return { ...state, resolve };
}
