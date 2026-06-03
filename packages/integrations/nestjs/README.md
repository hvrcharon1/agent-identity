<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-nestjs`

NestJS module, service, guard, and parameter decorator for the agent-identity framework.

## Install

```bash
npm install @datacules/agent-identity-nestjs @datacules/agent-identity
```

## Module registration

```typescript
// Synchronous
@Module({
  imports: [AgentIdentityModule.forRoot({ credentials, rules, logger })],
})
export class AppModule {}

// Asynchronous (ConfigService, vault, etc.)
@Module({
  imports: [
    AgentIdentityModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        credentials: cfg.get('AI_CREDENTIALS'),
        rules:       cfg.get('ROUTING_RULES'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## Guard + parameter decorator

```typescript
import { AgentIdentityGuard, ResolvedCredential } from '@datacules/agent-identity-nestjs';
import type { ResolvedCredential as Cred }        from '@datacules/agent-identity';

@Post('complete')
@UseGuards(AgentIdentityGuard)
async complete(@ResolvedCredential() cred: Cred) {
  // Guard ran before your handler and resolved the credential.
  // cred.ref → fetch raw secret from your vault here.
  return { resolvedFor: cred.resolvedFor };
}
```

By default the guard reads `request.body.agentContext`. Override `extractContext()` to read from a JWT or custom header:

```typescript
@Injectable()
export class MyGuard extends AgentIdentityGuard {
  protected extractContext(request: Request): AgentRequestContext {
    return JSON.parse(request.headers['x-agent-context'] as string);
  }
}
```

## Service (direct injection)

```typescript
@Injectable()
export class AiService {
  constructor(private readonly agentIdentity: AgentIdentityService) {}

  async run(ctx: AgentRequestContext) {
    const resolved = await this.agentIdentity.resolveAsync(ctx);
    if (!resolved) throw new ForbiddenException('No credential matched');
    // fetch raw secret from your vault using resolved.ref
  }

  async migrate(ctx: MigrationContext) {
    const pair = await this.agentIdentity.resolvePairAsync(ctx);
    // pair.source, pair.target
  }
}
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
