# @datacules/agent-identity-cli

CLI for [`@datacules/agent-identity`](https://github.com/hvrcharon1/agent-identity). Verify audit chain integrity, generate SOC 2/GDPR/HIPAA compliance reports, and test credential resolution — all from the command line.

## Installation

```bash
npm install -g @datacules/agent-identity-cli
```

or run without installing:

```bash
npx @datacules/agent-identity-cli audit verify --file ./audit.jsonl
```

## Prerequisites

- Node.js ≥ 20
- `@datacules/agent-identity-compliance` installed in the same project (peer dependency)

## Commands

### `audit verify`

Verify the SHA-256 hash chain of a JSONL audit log produced by `HashChainAuditLogger`.

```bash
# Verify an entire log
agent-identity audit verify --file ./audit.jsonl

# Verify only entries within a date range
agent-identity audit verify --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31
```

**Output on success:**
```
✓ Audit chain intact
  Entries verified : 14872
  Root hash        : a3f9c21e84b72d19…
```

**Output on failure:**
```
✗ Audit chain BROKEN
  Entries checked  : 14872
  Broken at index  : 8431
  Reason           : Entry 8431: hash mismatch — entry data appears to have been modified
```

Exit code 0 = intact, 1 = broken or error.

---

### `report <soc2|gdpr|hipaa>`

Generate a compliance report from a JSONL audit log.

```bash
# SOC 2 CC6 report — JSON to stdout
agent-identity report soc2 --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31

# GDPR Article 30 report — Markdown format
agent-identity report gdpr --file ./audit.jsonl --format markdown

# HIPAA §164.312 report — write to directory
agent-identity report hipaa --file ./audit.jsonl --output ./compliance-reports/
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | required | JSONL audit log file |
| `--from <date>` | start of current month | ISO 8601 date (e.g. `2026-01-01`) |
| `--to <date>` | now | ISO 8601 date |
| `--format` | `json` | `json` or `markdown` |
| `--output <dir>` | stdout | Directory to write the report file |

---

### `health`

Check if the agent-identity server (Next.js dashboard or sidecar) is running.

```bash
agent-identity health
agent-identity health --url http://localhost:3001   # sidecar
```

---

### `resolve`

Test credential resolution against the running server. Useful for verifying routing rules.

```bash
agent-identity resolve --provider openai --user user-123
agent-identity resolve --provider anthropic --user user-456 --url http://localhost:3001
```

**Output on success:**
```json
{
  "resolvedFor": "user-123",
  "credentialId": "cred-openai-prod",
  "provider": "openai"
}
```

---

## Typical compliance workflow

```bash
# 1. Your agent runs. The HashChainAuditLogger writes JSONL to a file.
#    (Configure a WebhookAuditLogger or custom sink to write entries.)

# 2. At quarter end, verify the log is untampered:
agent-identity audit verify --file /var/log/agent-identity/audit.jsonl \
  --from 2026-01-01 --to 2026-03-31

# 3. Generate the compliance report:
agent-identity report soc2 --file /var/log/agent-identity/audit.jsonl \
  --from 2026-01-01 --to 2026-03-31 \
  --output ./compliance-reports/

# 4. Attach the report to your SOC 2 audit package.
```

## Producing a JSONL audit log

```typescript
import { createWriteStream } from 'node:fs';
import { HashChainAuditLogger } from '@datacules/agent-identity-compliance';
import { createRouterFromStore } from '@datacules/agent-identity';

// Write one JSON object per line to a file
const stream = createWriteStream('/var/log/agent-identity/audit.jsonl', { flags: 'a' });
const fileSink = { log: (e: unknown) => stream.write(JSON.stringify(e) + '\n') };

const auditLogger = new HashChainAuditLogger(fileSink);
const router = createRouterFromStore(store, rules, auditLogger);
```

## License

MIT
