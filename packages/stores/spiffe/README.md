# `@datacules/agent-identity-store-spiffe`

SPIFFE/SPIRE workload identity integration for [`@datacules/agent-identity`](../../core). Each agent workload obtains an X.509 SVID from a SPIRE agent socket instead of reading static secrets — no credentials stored anywhere.

## Install

```bash
npm install @datacules/agent-identity-store-spiffe
```

## Why SPIFFE?

In cloud-native environments (Kubernetes, ECS, Cloud Run), static secrets are fragile — they can leak via environment variables, config maps, or container inspection. SPIFFE SVIDs are short-lived X.509 certificates (auto-renewed, typically 1-hour TTL) that cryptographically prove the workload's identity at the platform level. No secrets to store, no rotation scripts, no environment variable leakage.

## Usage

```typescript
import { SpiffeCredentialStore } from '@datacules/agent-identity-store-spiffe';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new SpiffeCredentialStore({
  spireSocketPath: '/run/spire/sockets/agent.sock',
  trustDomain: 'acme.com',
});

// Route by SPIFFE ID pattern in the routing rule
const rules = [
  {
    id: 'rule-orders-agent',
    description: 'Orders agent — read access via SPIFFE workload identity',
    matchSpiffeId: 'spiffe://acme.com/agent/orders-*', // glob pattern
    credentialRef: 'orders-db-slot',
    credentialKind: 'fixed',
    priority: 90,
  },
];

const router = createRouterFromStore(store, rules, logger);

// Include spiffeId in the context — SpiffeCredentialStore populates it from the SVID
const ctx = {
  ...baseCtx,
  spiffeId: 'spiffe://acme.com/agent/orders-prod',
};

const resolved = await router.resolveAsync(ctx);
```

## Kubernetes setup

Mount the SPIRE agent socket into your pod:

```yaml
volumes:
  - name: spire-agent-socket
    hostPath:
      path: /run/spire/sockets
      type: Directory
containers:
  - name: orders-agent
    volumeMounts:
      - name: spire-agent-socket
        mountPath: /run/spire/sockets
        readOnly: true
```

## Works across cloud providers

SPIRE handles node attestation for AWS EC2 (via IMDSv2), GCP Compute Engine, Azure VMs, and on-prem bare metal — no code changes between environments.
