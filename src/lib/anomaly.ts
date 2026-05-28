/**
 * Re-export shim: makes @datacules/agent-identity-anomaly types available
 * to Next.js API routes without crossing the packages/ workspace boundary.
 *
 * Mirrors the pattern used by src/lib/approval.ts, budget.ts, federation.ts.
 */
export type {
  AnomalySignal,
  AnomalySeverity,
  AnomalyAction,
  AnomalyEvent,
  AnomalyPolicy,
  AnomalyDetectorConfig,
} from '@datacules/agent-identity-anomaly';
export { AnomalyDetector } from '@datacules/agent-identity-anomaly';
