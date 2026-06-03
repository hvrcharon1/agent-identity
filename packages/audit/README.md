<p align="center">
  <img src="../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-audit`

Audit logger sinks for the agent-identity framework. Every `resolve()` call emits a structured `AuditLogEntry`; choose one sink or fan-out to multiple with `CompositeAuditLogger`.

## Install

```bash
npm install @datacules/agent-identity-audit
```

## Available sinks

| Sink | Description |
|------|-------------|
| `ConsoleAuditLogger` | Pretty-print to stdout — dev and testing |
| `WebhookAuditLogger` | HTTP POST with HMAC-SHA256 signature |
| `DatadogAuditLogger` | Sends to Datadog Log Management API |
| `SplunkAuditLogger` | Sends to Splunk HEC (HTTP Event Collector) |
| `CompositeAuditLogger` | Fan-out to multiple sinks simultaneously |

## Usage

```typescript
import {
  ConsoleAuditLogger,
  WebhookAuditLogger,
  DatadogAuditLogger,
  SplunkAuditLogger,
  CompositeAuditLogger,
} from '@datacules/agent-identity-audit';
import { createRouter } from '@datacules/agent-identity';

// Single sink
const logger = new ConsoleAuditLogger();

// Fan-out to multiple sinks
const logger = new CompositeAuditLogger([
  new ConsoleAuditLogger(),
  new DatadogAuditLogger({ apiKey: process.env.DD_API_KEY! }),
  new WebhookAuditLogger({
    url:    'https://hooks.example.com/agent-audit',
    secret: process.env.WEBHOOK_SECRET!,
  }),
  new SplunkAuditLogger({
    hecEndpoint: 'https://splunk.example.com:8088/services/collector',
    hecToken:    process.env.SPLUNK_HEC_TOKEN!,
  }),
]);

const router = createRouter(credentials, rules, logger);
```

## Audit log entry fields

Every entry includes:

```typescript
{
  timestamp:    string;    // ISO 8601
  traceId:      string;    // from AgentRequestContext
  userId:       string;
  action:       string;    // 'read' | 'write' | 'credential.anomaly' | ...
  resourceId:   string;
  resourceKind: string;
  credentialId: string;
  resolvedFor:  string;    // 'service' or userId
  provider:     string;
  model:        string;
}
```

## Tamper-evident chain

Wrap any sink with `HashChainAuditLogger` from `@datacules/agent-identity-compliance` to add SHA-256 hash-chain fields to every entry. See that package's README for details.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
