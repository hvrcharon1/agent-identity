# `@datacules/agent-identity-compliance`

Automated compliance report generation for [`@datacules/agent-identity`](../../core). Answers regulatory audit questions directly from your audit logs — no custom queries.

## Install

```bash
npm install @datacules/agent-identity-compliance
```

## Usage

```typescript
import { ComplianceReportGenerator, MemoryReportStore } from '@datacules/agent-identity-compliance';

const generator = new ComplianceReportGenerator({
  store: new MemoryReportStore(auditEntries), // or your own ReportStore
  piiTags: ['pii', 'phi', 'personal', 'financial'],
  businessHoursStart: 9,
  businessHoursEnd: 18,
});

// SOC 2 CC6 — Logical and Physical Access Controls
const report = await generator.generate({
  type: 'soc2',
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-31T23:59:59Z',
});

// GDPR Article 30 — Records of Processing Activities
const gdprReport = await generator.generate({
  type: 'gdpr',
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-31T23:59:59Z',
  format: 'markdown', // returns a formatted markdown string in report.summary
});

console.log(report.agentAccessSummary);      // which agents used which credentials
console.log(report.piiResourceAccess);       // all accesses to PII-tagged resources
console.log(report.offHoursAccess);          // accesses outside business hours
console.log(report.credentialRotationHistory); // rotation events
console.log(report.anomalyEvents);           // all flagged anomalies
```

## Report contents

| Section | Description |
|---------|-------------|
| `agentAccessSummary` | Per-agent resolution counts, credentials used, resources accessed |
| `piiResourceAccess` | All resolutions against resources tagged `pii`, `phi`, or `personal` |
| `offHoursAccess` | Resolutions outside configured business hours (includes weekends) |
| `credentialRotationHistory` | `credential.rotated` events — when, which credential |
| `anomalyEvents` | All `credential.anomaly` events with signal and severity |

## Custom ReportStore

```typescript
import type { ReportStore } from '@datacules/agent-identity-compliance';

class PostgresReportStore implements ReportStore {
  async queryEntries(from: string, to: string) {
    return db.query('SELECT * FROM audit_log WHERE timestamp BETWEEN $1 AND $2', [from, to]);
  }
}
```
