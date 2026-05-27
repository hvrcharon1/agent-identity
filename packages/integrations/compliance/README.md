# `@datacules/agent-identity-compliance`

Compliance report generation + tamper-evident audit log for [`@datacules/agent-identity`](../../core).

Answers regulatory audit questions directly from your audit logs — no custom queries.
Provides a SHA-256 hash chain logger and CLI verifier for SOC 2, GDPR, and HIPAA evidence.

## Install

```bash
npm install @datacules/agent-identity-compliance
```

## Features

| Feature | Description |
|---------|-------------|
| `ComplianceReportGenerator` | Generate SOC 2 / GDPR / HIPAA reports from audit logs |
| `HashChainAuditLogger` | Wraps any audit sink — appends SHA-256 chain fields to every entry |
| `ChainVerifier` | Replays the chain and returns intact/broken status |
| CLI `agent-identity audit verify` | Verify a JSONL audit log file from the command line |
| CLI `agent-identity report` | Generate a compliance report from a JSONL audit log file |

---

## Compliance Reports

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

// GDPR Article 30 — Records of Processing Activities (Markdown output)
const gdprReport = await generator.generate({
  type: 'gdpr',
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-31T23:59:59Z',
  format: 'markdown',
});

console.log(report.agentAccessSummary);        // which agents used which credentials
console.log(report.piiResourceAccess);         // all accesses to PII-tagged resources
console.log(report.offHoursAccess);            // accesses outside business hours
console.log(report.credentialRotationHistory); // rotation events
console.log(report.anomalyEvents);             // all flagged anomalies
```

### Report sections

| Section | Description |
|---------|-------------|
| `agentAccessSummary` | Per-agent resolution counts, credentials used, resources accessed |
| `piiResourceAccess` | All resolutions against resources tagged `pii`, `phi`, or `personal` |
| `offHoursAccess` | Resolutions outside configured business hours (includes weekends) |
| `credentialRotationHistory` | `credential.rotated` events — when, which credential |
| `anomalyEvents` | All `credential.anomaly` events with signal and severity |

---

## Tamper-Evident Audit Log (Hash Chain)

Wrap any existing audit logger to make every entry part of a SHA-256 linked chain:

```typescript
import { HashChainAuditLogger } from '@datacules/agent-identity-compliance';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';
import { createRouter } from '@datacules/agent-identity';

// 1. Wrap any existing logger
const base = new ConsoleAuditLogger();
const chained = new HashChainAuditLogger(base);

// 2. Use the chained logger with the router — everything else is unchanged
const router = createRouter(credentials, rules, chained);
```

The underlying sink receives entries with two extra fields:

```json
{
  "userId": "user-abc",
  "credentialId": "cred-openai",
  "action": "read",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "...": "...",
  "prevHash": "a3f8...",
  "hash":     "9c12..."
}
```

Any retroactive modification to any field in any entry breaks the chain from that point forward — detectable in O(n) time.

### Verifying the chain programmatically

```typescript
import { ChainVerifier } from '@datacules/agent-identity-compliance';
import { readFileSync } from 'node:fs';

const jsonl = readFileSync('./audit.jsonl', 'utf8');
const result = ChainVerifier.verifyJsonl(jsonl);

console.log(result.intact);      // true / false
console.log(result.entryCount);  // number of entries verified
console.log(result.rootHash);    // SHA-256 of the last entry (publish to an anchor)
console.log(result.brokenAt);    // entry index of first broken link (null if intact)
console.log(result.brokenReason); // human-readable reason (null if intact)
```

---

## CLI

The package ships a zero-dependency CLI (`agent-identity`) for offline log verification and report generation.

### Verify an audit log

```bash
agent-identity audit verify --file ./audit.jsonl
```

Output:
```
Audit log verification — /path/to/audit.jsonl
Entries verified : 47382
Chain status     : ✅  INTACT
Chain root hash  : 9c12a3f8...b4e2
```

If a line has been modified:
```
Chain status     : ❌  BROKEN
Broken at entry  : 1204
Reason           : Entry 1204: hash mismatch — entry data appears to have been modified
```

Exit code 0 = intact, exit code 1 = broken or empty. Suitable for CI gates:

```bash
agent-identity audit verify --file ./audit.jsonl || { echo "Audit log tampered!"; exit 1; }
```

### Generate a compliance report

```bash
# SOC 2 CC6 — JSON output (default)
agent-identity report soc2 --file ./audit.jsonl

# GDPR Article 30 — Markdown, filtered to Q1 2026
agent-identity report gdpr \
  --file ./audit.jsonl \
  --from 2026-01-01 \
  --to   2026-03-31 \
  --format markdown

# HIPAA §164.312 — save to file
agent-identity report hipaa --file ./audit.jsonl > ./reports/hipaa-q2.json
```

---

## Custom ReportStore

```typescript
import type { ReportStore } from '@datacules/agent-identity-compliance';

class PostgresReportStore implements ReportStore {
  async queryEntries(from: string, to: string) {
    return db.query(
      'SELECT * FROM audit_log WHERE timestamp BETWEEN $1 AND $2 ORDER BY timestamp ASC',
      [from, to]
    );
  }
}

const generator = new ComplianceReportGenerator({ store: new PostgresReportStore() });
```
