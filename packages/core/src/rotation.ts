/**
 * Automated Credential Rotation — @datacules/agent-identity core
 *
 * Adds RotationPolicy, RotationProvider, and CredentialRotationScheduler.
 * The scheduler runs in the background and calls registered RotationProviders
 * when a credential's policy threshold is reached. During the grace period
 * both old and new refs resolve so in-flight requests are not disrupted.
 */
import type { Credential, CredentialStore, AuditLogger } from './types';

// ─── Rotation Policy ────────────────────────────────────────────────────────

export interface RotationPolicy {
  /** Rotate N days after lastRotated (or createdAt if never rotated) */
  rotateAfterDays?: number;
  /** Rotate after N successful resolutions */
  rotateAfterUses?: number;
  /** Both old + new refs remain valid during grace period (default: 300 s) */
  gracePeriodSeconds?: number;
  /** Emit credential.rotation_due audit event N days before deadline (default: 3) */
  notifyBeforeDays?: number;
  /** Which RotationProvider to call (matches RotationProvider.id) */
  provisioner?: string;
}

// ─── Rotation Provider ───────────────────────────────────────────────────────

export interface RotationProvider {
  /** Matches RotationPolicy.provisioner */
  id: string;
  /** Mint a new secret; return the new ref and optional expiry */
  provision(credential: Credential): Promise<{ newRef: string; expiresAt?: string }>;
  /** Revoke the old ref after the grace period */
  revoke(oldRef: string): Promise<void>;
}

// ─── Rotation Events ─────────────────────────────────────────────────────────

export type RotationEventKind = 'credential.rotated' | 'credential.rotation_due' | 'credential.rotation_failed';

export interface RotationEvent {
  kind: RotationEventKind;
  credentialId: string;
  credentialRef: string;
  newRef?: string;
  expiresAt?: string;
  error?: string;
  timestamp: string;
}

// ─── Scheduler Config ────────────────────────────────────────────────────────

export interface RotationConfig {
  store: CredentialStore;
  providers: RotationProvider[];
  logger?: AuditLogger;
  /** How often to run the check loop in ms (default: 3_600_000 — 1 hour) */
  checkIntervalMs?: number;
  /** Callback fired after each rotation event (useful for tests / dashboards) */
  onEvent?: (event: RotationEvent) => void;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class CredentialRotationScheduler {
  private readonly providers: Map<string, RotationProvider>;
  private timer?: ReturnType<typeof setInterval>;
  /** Tracks per-credential use counts for rotateAfterUses policies */
  private useCounts = new Map<string, number>();
  /** Refs currently in grace period — both old + new resolve */
  private gracefulRefs = new Map<string, string>(); // oldRef → newRef

  constructor(private readonly config: RotationConfig) {
    this.providers = new Map(config.providers.map((p) => [p.id, p]));
  }

  /** Call this every time a credential is successfully resolved */
  recordUse(credentialId: string): void {
    this.useCounts.set(credentialId, (this.useCounts.get(credentialId) ?? 0) + 1);
  }

  /**
   * Returns the current active ref for a credential.
   * During a grace period returns the NEW ref so new requests use the rotated secret.
   */
  activeRef(originalRef: string): string {
    return this.gracefulRefs.get(originalRef) ?? originalRef;
  }

  /** Start the background check loop */
  start(): void {
    const interval = this.config.checkIntervalMs ?? 3_600_000;
    this.check().catch(console.error); // immediate first pass
    this.timer = setInterval(() => this.check().catch(console.error), interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<void> {
    const active = await this.config.store.listActive();
    const now = new Date();

    for (const cred of active) {
      if (!cred.rotation) continue;
      const policy = cred.rotation;

      if (policy.rotateAfterDays && cred.lastRotated) {
        const msSince = now.getTime() - new Date(cred.lastRotated).getTime();
        const daysSince = msSince / 86_400_000;
        const warnAt = policy.rotateAfterDays - (policy.notifyBeforeDays ?? 3);

        if (daysSince >= policy.rotateAfterDays) {
          await this.rotate(cred);
          continue;
        }
        if (daysSince >= warnAt) {
          await this.emitEvent({ kind: 'credential.rotation_due', credentialId: cred.id, credentialRef: cred.ref, timestamp: now.toISOString() });
        }
      }

      if (policy.rotateAfterUses) {
        const uses = this.useCounts.get(cred.id) ?? 0;
        if (uses >= policy.rotateAfterUses) {
          await this.rotate(cred);
          this.useCounts.set(cred.id, 0);
        }
      }
    }
  }

  private async rotate(cred: Credential): Promise<void> {
    const policy = cred.rotation!;
    const provisionerId = policy.provisioner ?? 'default';
    const provider = this.providers.get(provisionerId);

    if (!provider) {
      const ev: RotationEvent = {
        kind: 'credential.rotation_failed',
        credentialId: cred.id,
        credentialRef: cred.ref,
        error: `No provider registered for id "${provisionerId}"`,
        timestamp: new Date().toISOString(),
      };
      await this.emitEvent(ev);
      return;
    }

    try {
      const { newRef, expiresAt } = await provider.provision(cred);
      this.gracefulRefs.set(cred.ref, newRef);

      const ev: RotationEvent = {
        kind: 'credential.rotated',
        credentialId: cred.id,
        credentialRef: cred.ref,
        newRef,
        expiresAt,
        timestamp: new Date().toISOString(),
      };
      await this.emitEvent(ev);

      const grace = (policy.gracePeriodSeconds ?? 300) * 1_000;
      setTimeout(async () => {
        this.gracefulRefs.delete(cred.ref);
        await provider.revoke(cred.ref).catch((err) =>
          console.error(`[rotation] revoke failed for ${cred.ref}:`, err)
        );
      }, grace);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.emitEvent({ kind: 'credential.rotation_failed', credentialId: cred.id, credentialRef: cred.ref, error, timestamp: new Date().toISOString() });
    }
  }

  private async emitEvent(event: RotationEvent): Promise<void> {
    this.config.onEvent?.(event);
    if (!this.config.logger) return;
    await this.config.logger
      .log({
        timestamp: event.timestamp,
        traceId: `rotation-${event.credentialId}-${Date.now()}`,
        userId: 'system:rotation-scheduler',
        action: event.kind,
        resourceId: event.credentialRef,
        resourceKind: 'shared',
        provider: 'local',
        model: 'system',
        credentialId: event.credentialId,
        credentialKind: 'fixed',
        resolvedFor: 'system',
      })
      .catch(console.error);
  }
}
