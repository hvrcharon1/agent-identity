<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-anomaly`

Behavioral baseline and anomaly detection for [`@datacules/agent-identity`](../../core). Wraps your audit pipeline with zero routing config changes — each agent builds a rolling baseline and deviations trigger `credential.anomaly` audit events.

## Install

```bash
npm install @datacules/agent-identity-anomaly
```

## Usage

```typescript
import { withAnomalyDetection } from '@datacules/agent-identity-anomaly';
import { createRouter } from '@datacules/agent-identity';

const router = withAnomalyDetection(
  createRouter(credentials, rules, auditLogger),
  {
    policies: [
      { severity: 'low',    action: 'warn' },     // emit credential.anomaly audit event
      { severity: 'medium', action: 'throttle' }, // rate-limit to 10% of normal
      { severity: 'high',   action: 'block' },    // return null — deny the resolution
    ],
    onAnomaly: (event) => {
      alertingService.send(
        `Anomaly: ${event.signal} (${event.severity}) for agent ${event.userId}`
      );
    },
  }
);

// Use router exactly as before — anomaly detection is transparent
const resolved = await router.resolveAsync(ctx);
if (!resolved) {
  // null means either no rule matched OR anomaly policy was 'block'
}
```

## Detected signals

| Signal | Severity | Description |
|--------|----------|-------------|
| `rate_spike` | high | Call rate 3× the hourly EWMA |
| `new_credential_type` | medium | Credential kind never seen before |
| `new_action_type` | medium | Action (`read`/`write`/etc.) never seen before |
| `new_resource_kind` | medium | Resource kind (`shared`/`personal`) never seen before |
| `new_provider` | low | AI provider never seen before |
| `off_hours` | low | Baseline was daytime only; now receiving night calls |

## Audit event format

Every anomaly emits a `credential.anomaly` audit entry:

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

## Response policies

| Action | Behaviour |
|--------|-----------|
| `warn` | Emit `credential.anomaly` audit event; return credential normally |
| `throttle` | Emit event; allow only 10% of requests through (random sampling) |
| `block` | Emit event; return `null` so the caller must abort or escalate to human review |

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
