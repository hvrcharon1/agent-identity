<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-fastify`

Fastify plugin for the agent-identity framework. Resolves credentials server-side and decorates each request with `request.resolvedCredential`.

## Install

```bash
npm install @datacules/agent-identity-fastify @datacules/agent-identity
```

## Usage

```typescript
import Fastify from 'fastify';
import { agentIdentityPlugin } from '@datacules/agent-identity-fastify';
import { credentials, rules, logger } from './config';

const app = Fastify();

await app.register(agentIdentityPlugin, { credentials, rules, logger });

app.post('/ai/complete', async (request, reply) => {
  const { ref, resolvedFor, credentialId } = request.resolvedCredential!;
  // ref → fetch the raw secret from your vault server-side
  return { resolvedFor };
});

await app.listen({ port: 3000 });
```

## Plugin options

```typescript
await app.register(agentIdentityPlugin, {
  credentials,       // Credential[]
  rules,             // RoutingRule[]
  logger,            // AuditLogger (optional)
  store,             // CredentialStore (alternative to credentials[])
  contextKey: 'body.agentContext',  // default path in request body
});
```

## TypeScript decoration

The plugin augments `FastifyRequest` with `resolvedCredential?: ResolvedCredential` via Fastify's decoration system — no manual augmentation needed.

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
