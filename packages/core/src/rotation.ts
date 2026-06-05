/**
 * Automated Credential Rotation — Feature #4 from FEATURE_SUGGESTIONS.md
 *
 * Additions in this version:
 *   - rotateAfterUses: optional getUsageCount callback; isRotationDue() is now
 *     async so it can query usage counts alongside the days check.
 *   - Grace period: graceWindows Map tracks old ref for gracePeriodSeconds after
 *     a successful rotation. runOnce() skips re-rotation while in the window.
 *     inGracePeriod() and getGraceRef() are public so routers can accept both
 *     the old and new ref during the handover window.
 *   - RotationSchedulerOptions interface + static fromOptions() factory.
 *   - Constructor is backwards-compatible: getUsageCount is an optional third param.
 */
import type { Credential, AuditLogger, RotationPolicy } from './types';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface RotationProvider {
  id: string;
  rotate(credential: Credential): Promise<{ newRef: string; rotatedAt: string }>;
}

export interface RotationRepository {
  listActive(): Promise<Credential[]>;
  update(id: string, patch: Partial<Credential>): Promise<void>;
}

export interface RotationSchedulerOptions {
  repository: RotationRepository;
  auditLogger?: AuditLogger;
  /**
   * Returns how many times a credential has been used since its last rotation.
   * Required for rotateAfterUses enforcement. Typically delegates to a usage
   * counter maintained alongside audit events or budget tracking.
   */
  getUsageCount?: (credentialId: string) => Promise<number>;
}

// ─── CredentialRotationScheduler ──────────────────────────────────────────────

export class CredentialRotationScheduler {
  private readonly providers = new Map<string, RotationProvider>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Tracks credentials that are inside their post-rotation grace window.
   * During the window, the old ref is still valid for in-flight requests
   * (resolved externally via getGraceRef()), and no new rotation is triggered.
   */
  private readonly graceWindows = new Map<string, { oldRef: string; endsAt: number }>();

  constructor(
    private readonly repository: RotationRepository,
    private readonly auditLogger?: AuditLogger,
    private readonly getUsageCount?: (credentialId: string) => Promise<number>,
  ) {}

  /** Alternate constructor from an options object. */
  static fromOptions(opts: RotationSchedulerOptions): CredentialRotationScheduler {
    return new CredentialRotationScheduler(opts.repository, opts.auditLogger, opts.getUsageCount);
  }

  registerProvider(provider: RotationProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Returns true when a credential is inside its post-rotation grace window.
   * Expired entries are pruned on read.
   */
  inGracePeriod(credentialId: string): boolean {
    const grace = this.graceWindows.get(credentialId);
    if (!grace) return false;
    if (grace.endsAt > Date.now()) return true;
    this.graceWindows.delete(credentialId);
    return false;
  }

  /**
   * Returns the OLD credential ref while the grace window is active, or null.
   * Use this in routers that need to accept both the old and new ref during
   * the post-rotation handover period (e.g. for in-flight HTTP requests).
   */
  getGraceRef(credentialId: string): string | null {
    const grace = this.graceWindows.get(credentialId);
    return grace && grace.endsAt > Date.now() ? grace.oldRef : null;
  }

  async runOnce(): Promise<void> {
    const credentials = await this.repository.listActive();
    const now = new Date();

    for (const cred of credentials) {
      if (!cred.rotation) continue;
      if (cred.status === 'unclaimed') continue;

      // Skip when inside the grace window from a recent rotation
      if (this.inGracePeriod(cred.id)) continue;

      const due = await this.isRotationDue(cred, cred.rotation, now);
      if (!due) {
        await this.maybeEmitWarning(cred, cred.rotation, now);
        continue;
      }

      const provider = cred.rotation.provisioner
        ? this.providers.get(cred.rotation.provisioner)
        : null;

      if (!provider) {
        console.warn(
          `[RotationScheduler] No provider for credential ${cred.id} (provisioner: ${cred.rotation.provisioner ?? 'unset'})`,
        );
        continue;
      }

      try {
        const { newRef, rotatedAt } = await provider.rotate(cred);

        // Record the grace window BEFORE updating the store so any in-flight
        // resolution holding the old ref can still resolve cleanly.
        if (cred.rotation.gracePeriodSeconds && cred.rotation.gracePeriodSeconds > 0) {
          this.graceWindows.set(cred.id, {
            oldRef: cred.ref,
            endsAt: Date.now() + cred.rotation.gracePeriodSeconds * 1000,
          });
        }

        await this.repository.update(cred.id, { ref: newRef, lastRotated: rotatedAt });

        if (this.auditLogger) {
          await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            traceId: `rotation-${cred.id}`,
            userId: 'system',
            action: 'credential.rotated',
            resourceId: cred.id,
            resourceKind: 'shared',
            provider: 'local',
            model: 'system',
            credentialId: cred.id,
            credentialKind: cred.kind,
            resolvedFor: 'system',
          });
        }
      } catch (err) {
        console.error(`[RotationScheduler] Rotation failed for ${cred.id}:`, err);
        if (this.auditLogger) {
          await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            traceId: `rotation-${cred.id}`,
            userId: 'system',
            action: 'credential.rotation_failed',
            resourceId: cred.id,
            resourceKind: 'shared',
            provider: 'local',
            model: 'system',
            credentialId: cred.id,
            credentialKind: cred.kind,
            resolvedFor: 'system',
          });
        }
      }
    }
  }

  start(intervalMs = 3_600_000): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(console.error);
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async isRotationDue(cred: Credential, policy: RotationPolicy, now: Date): Promise<boolean> {
    // Days-based rotation
    if (policy.rotateAfterDays !== undefined && cred.lastRotated) {
      const daysSince = (now.getTime() - new Date(cred.lastRotated).getTime()) / 86_400_000;
      if (daysSince >= policy.rotateAfterDays) return true;
    }

    // Uses-based rotation — requires a getUsageCount callback
    if (policy.rotateAfterUses !== undefined && this.getUsageCount) {
      const count = await this.getUsageCount(cred.id);
      if (count >= policy.rotateAfterUses) return true;
    }

    return false;
  }

  private async maybeEmitWarning(cred: Credential, policy: RotationPolicy, now: Date): Promise<void> {
    if (!this.auditLogger) return;
    if (
      policy.notifyBeforeDays !== undefined &&
      policy.rotateAfterDays !== undefined &&
      cred.lastRotated
    ) {
      const daysUntilDue =
        policy.rotateAfterDays -
        (now.getTime() - new Date(cred.lastRotated).getTime()) / 86_400_000;
      if (daysUntilDue > 0 && daysUntilDue <= policy.notifyBeforeDays) {
        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          traceId: `rotation-warning-${cred.id}`,
          userId: 'system',
          action: 'credential.rotation_due',
          resourceId: cred.id,
          resourceKind: 'shared',
          provider: 'local',
          model: 'system',
          credentialId: cred.id,
          credentialKind: cred.kind,
          resolvedFor: 'system',
        });
      }
    }
  }
}
