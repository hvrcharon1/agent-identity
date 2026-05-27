# `@datacules/agent-identity-store-spiffe`

SPIFFE/SPIRE workload identity credential store for [`@datacules/agent-identity`](https://github.com/hvrcharon1/agent-identity).

Instead of static long-lived API keys stored in a vault, this store uses the **SPIFFE Workload API** to fetch short-lived **X.509 SVIDs** (SPIFFE Verifiable Identity Documents) on demand. A full store compromise yields only workload metadata — no usable credential material.

---

## How it works

1. On `resolve()`, the store looks up credential metadata by `ref`.
2. It calls the SPIRE Workload API socket to fetch the current X.509 SVID bundle for that workload.
3. The SVID's PEM certificate chain is returned as the live credential value.
4. Downstream services verify the chain against the trust bundle — no static API key ever travels over the wire.
5. SVIDs are cached in memory until 5 minutes before expiry (configurable), then re-fetched transparently.

---

## Installation

```bash
npm install @datacules/agent-identity-store-spiffe @spiffe/spiffe-workload-api
```

---

## Usage

```typescript
import { SpiffeCredentialStore } from '@datacules/agent-identity-store-spiffe';
import { createRouterFromStore } from '@datacules/agent-identity';

const store = new SpiffeCredentialStore({
  trustDomain: 'acme.org',
  endpointSocket: 'unix:///run/spire/sockets/agent.sock', // or SPIFFE_ENDPOINT_SOCKET env
  credentials: [
    {
      id: 'cred-orders-service',
      ref: 'orders-service',        // matched against SVID hint or path segment
      kind: 'fixed',
      name: 'Orders service workload identity',
      scope: 'all',
      status: 'active',
      provider: 'local',
    },
  ],
});

const router = createRouterFromStore(store, rules, logger);
const resolved = await router.resolveAsync(ctx);
// resolved.ref contains the PEM X.509 SVID — pass it to mTLS or a
// downstream service that verifies SPIFFE SVIDs
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `credentials` | `Credential[]` | required | Static metadata for each workload |
| `endpointSocket` | `string` | `SPIFFE_ENDPOINT_SOCKET` env or `/tmp/spire-agent/public/api.sock` | SPIFFE Workload API socket path |
| `trustDomain` | `string` | `example.org` | SPIFFE trust domain (e.g. `acme.org`) |
| `cacheTtlSeconds` | `number` | `3300` (55 min) | How long to cache SVIDs before re-fetching |

---

## SVID matching

The store matches a credential `ref` to an SVID using three strategies (first match wins):

1. **Hint match** — SVID `hint` field equals the credential `ref`
2. **Path suffix** — SPIFFE ID ends with `/<ref>` (e.g. `spiffe://acme.org/orders-service`)
3. **Exact SPIFFE ID** — SPIFFE ID equals `spiffe://<trustDomain>/<ref>`

---

## SPIRE server setup

```bash
# Register a workload entry for your service
spire-server entry create \
  -spiffeID spiffe://acme.org/orders-service \
  -parentID  spiffe://acme.org/agent/prod \
  -selector  k8s:pod-label:app:orders-service

# The SPIRE agent on the node will attest the workload and issue SVIDs
# automatically. No API key management required.
```

---

## Zero-trust architecture

Combine with `@datacules/agent-identity-otel` for full observability:

```typescript
import { withOtel } from '@datacules/agent-identity-otel';

const router = withOtel(
  createRouterFromStore(spiffeStore, rules, logger),
  { tracer: trace.getTracer('agent-identity') }
);
```

Every SVID fetch, cache hit/miss, and credential resolution is traced.
