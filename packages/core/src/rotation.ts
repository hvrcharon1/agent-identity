/**
 * Automated Credential Rotation — Feature #4 from FEATURE_SUGGESTIONS.md
 *
 * RotationPolicy on Credential + CredentialRotationScheduler that detects
 * expiring/due credentials and calls registered RotationProvider instances
 * to mint new secrets.
 */
import type { Credential, AuditLogger, RotationPolicy } from './types';

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * A RotationProvider mints a new secret for a credential and updates the
 * store. Built-in providers: VaultRotationProvider, AwsRotationProvider.
 * Custom providers implement this interface.
 */
export interface RotationProvider {
  id: string;
  rotate(credential: Credential): Promise<{ newRef: string; rotatedAt: string }>;
}

/**
 * CredentialRepository is a minimal interface over any CredentialStore that
 * supports mutation — listing and updating credentials. The core store
 * interface is read-only for callers; rotation needs write access.
 */
export interface RotationRepository {
  listActive(): Promise<Credential[]>;
  update(id: string, patch: Partial<Credential>): Promise<void>;
}

// ─── CredentialRotationScheduler ───────────────────────────────────────────────

export class CredentialRotationScheduler {
  private readonly providers = new Map<string, RotationProvider>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: RotationRepository,
    private readonly auditLogger?: AuditLogger
  ) {}

  registerProvider(provider: RotationProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Check all active credentials for pending rotation and rotate them.
   * Call this on a schedule (e.g. every hour via cron or setInterval).
   */
  async runOnce(): Promise<void> {
    const credentials = await this.repository.listActive();
    const now = new Date();

    for (const cred of credentials) {
      // Skip credentials with no rotation policy
      if (!cred.rotation) continue;

      // Skip unclaimed auth.md credentials — they cannot be rotated until
      // the claim ceremony is complete and status flips to 'active'
      if (cred.status === 'unclaimed') continue;

      const due = this.isRotationDue(cred, cred.rotation, now);
      if (!due) {
        await this.maybeEmitWarning(cred, cred.rotation, now);
        continue;
      }

      const provider = cred.rotation.provisioner
        ? this.providers.get(cred.rotation.provisioner)
        : null;

      if (!provider) {
        console.warn(`[RotationScheduler] No provider for credential ${cred.id} (provisioner: ${cred.rotation.provisioner ?? 'unset'})`);
        continue;
      }

      try {
        const { newRef, rotatedAt } = await provider.rotate(cred);
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

  /**
   * Start a background rotation loop at the given interval.
   * @param intervalMs Check frequency in milliseconds (default: 3600000 = 1 hour)
   */
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

  private isRotationDue(cred: Credential, policy: RotationPolicy, now: Date): boolean {
    if (policy.rotateAfterDays !== undefined && cred.lastRotated) {
      const lastRotated = new Date(cred.lastRotated);
      const daysSince = (now.getTime() - lastRotated.getTime()) / 86_400_000;
      if (daysSince >= policy.rotateAfterDays) return true;
    }
    return false;
  }

  private async maybeEmitWarning(cred: Credential, policy: RotationPolicy, now: Date): Promise<void> {
    if (!this.auditLogger) return;
    if (policy.notifyBeforeDays !== undefined && policy.rotateAfterDays !== undefined && cred.lastRotated) {
      const lastRotated = new Date(cred.lastRotated);
      const daysUntilDue = policy.rotateAfterDays - (now.getTime() - lastRotated.getTime()) / 86_400_000;
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
