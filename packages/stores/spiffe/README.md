<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-store-spiffe`

SPIFFE/SPIRE workload identity store for the agent-identity framework. Zero static credentials — the agent is cryptographically attested by SPIRE and receives short-lived X.509 SVIDs that are auto-renewed.

## Install

```bash
npm install @datacules/agent-identity-store-spiffe
```

## Usage

```typescript
import { SpiffeCredentialStore }  from '@datacules/agent-identity-store-spiffe';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new SpiffeCredentialStore({
  spiffeEndpointSocket: 'unix:///run/spire/sockets/agent.sock',
  trustDomain: 'acme.com',
});

// Routing rule matched by SPIFFE ID
const rules = [
  {
    id:            'rule-orders-agent',
    matchSpiffeId: 'spiffe://acme.com/ns/production/sa/orders-agent',
    credentialRef: 'orders-db-slot',
    credentialKind:'fixed',
    priority:      90,
  },
];

const router = createRouterFromStore(store, rules, logger);
// ctx.spiffeId must be set to the workload's SPIFFE ID
const resolved = await router.resolveAsync(ctx);
```

## How it works

1. The SPIRE agent runs as a DaemonSet (Kubernetes) or system service.
2. On `findByRef()` the store calls the SPIRE Workload API over a Unix socket to fetch the workload's current X.509 SVID bundle.
3. The SVID is cached until 60 seconds before its `notAfter` time, then automatically renewed.
4. The credential's `ref` field contains the PEM-encoded certificate — injected server-side into the outbound request.
5. Routing rules use `matchSpiffeId` (exact string or glob) to select the right SVID for each downstream service.

## Why use this?

- **Zero static secrets** — no API keys, passwords, or tokens stored anywhere.
- **Cryptographic attestation** — SPIRE verifies the workload's identity via OS primitives (kernel attestation, Kubernetes service account, AWS EC2 instance identity).
- **Short-lived credentials** — default SVID TTL is 1 hour; compromise window is minimal.
- **mTLS ready** — SVIDs can authenticate mutual TLS connections to downstream services directly.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
