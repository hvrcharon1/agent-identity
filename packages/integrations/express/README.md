<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-express`

Express middleware for the agent-identity framework. Resolves credentials server-side and attaches the result to `req.resolvedCredential` before your route handler runs.

## Install

```bash
npm install @datacules/agent-identity-express @datacules/agent-identity
```

## Usage

```typescript
import express from 'express';
import { agentIdentityMiddleware } from '@datacules/agent-identity-express';
import { credentials, rules, logger } from './config';

const app = express();
app.use(express.json()); // required before the middleware

// Mount on any route prefix
app.use('/ai', agentIdentityMiddleware({ credentials, rules, logger }));

app.post('/ai/complete', (req, res) => {
  const { ref, resolvedFor, credentialId } = req.resolvedCredential!;
  // ref   → look up the raw secret in your vault (server-side only)
  // Never return ref or the raw secret to the client
  res.json({ resolvedFor });
});

app.listen(3000);
```

## Configuration

```typescript
agentIdentityMiddleware({
  credentials,          // Credential[] (or omit if using `store`)
  rules,                // RoutingRule[]
  logger,               // AuditLogger (optional)
  store,                // CredentialStore (alternative to credentials[])
  contextKey: 'body.agentContext',  // default: reads req.body.agentContext
})
```

Override `contextKey` to read the context from a header or nested body field.

## TypeScript augmentation

```typescript
// src/types/express.d.ts
import type { ResolvedCredential } from '@datacules/agent-identity';
declare global {
  namespace Express {
    interface Request {
      resolvedCredential?: ResolvedCredential;
    }
  }
}
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
