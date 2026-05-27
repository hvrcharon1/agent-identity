# `@datacules/agent-identity-anomaly`

Behavioral baseline and anomaly detection for [`@datacules/agent-identity`](../../core). Wraps your audit pipeline with zero routing config changes — each agent builds a rolling baseline and deviations trigger `credential.anomaly` audit events.

## Install

```bash
npm install @datacules/agent-identity-anomaly
```

## Usage

```typescript
import { AnomalyDetector } from '@datacules/agent-identity-anomaly';

const detector = new AnomalyDetector({
  logger,
  policy: {
    lowAction: 'warn',      // emit audit event only
    mediumAction: 'warn',   // same
    highAction: 'block',    // return null — credential denied
    baselineSamples: 20,    // collect 20 resolutions before scoring starts
    rateSpikeThreshold: 3.0, // flag if current rate > 3x rolling average
  },
  onAnomaly: (event) => {
    alertingService.send(`Anomaly detected: ${event.signal} (${event.severity}) for ${event.userId}`);
  },
});

// Wrap your resolveAsync call
const resolved = await detector.observe(ctx, () => router.resolveAsync(ctx));
if (!resolved) {
  // anomaly detected + policy was 'block' — the model layer should not proceed
}
```

## Detected signals

| Signal | Severity | Description |
|--------|----------|-------------|
| `rate_spike` | high | Call rate 3x the hourly EWMA |
| `new_credential_type` | medium | Credential kind never seen before |
| `new_action_type` | medium | Action (`read`/`write`/etc.) never seen before |
| `new_resource_kind` | medium | Resource kind (`shared`/`personal`) never seen before |
| `new_provider` | low | AI provider never seen before |
| `off_hours` | low | Baseline was daytime only; now receiving night calls |

## Audit event format

Every anomaly emits a `credential.anomaly` audit entry with additional fields:

```json
{
  "action": "credential.anomaly",
  "signal": "rate_spike",
  "severity": "high",
  "baselineValue": 12.4,
  "observedValue": 87,
  "userId": "agent-orders"
}
```
