/**
 * NestJS DynamicModule for @datacules/agent-identity.
 *
 * Synchronous registration:
 *   @Module({ imports: [AgentIdentityModule.forRoot({ credentials, rules, logger })] })
 *
 * Asynchronous / config-service registration:
 *   @Module({
 *     imports: [
 *       AgentIdentityModule.forRootAsync({
 *         imports: [ConfigModule],
 *         useFactory: (cfg: ConfigService) => ({
 *           credentials: cfg.get('AI_CREDENTIALS'),
 *           rules:       cfg.get('ROUTING_RULES'),
 *         }),
 *         inject: [ConfigService],
 *       }),
 *     ],
 *   })
 */
import { DynamicModule, Module } from '@nestjs/common';
import type { AuditLogger, Credential, RoutingRule } from '@datacules/agent-identity';
import { AgentIdentityService } from './AgentIdentityService';

export interface AgentIdentityModuleOptions {
  credentials: Credential[];
  rules: RoutingRule[];
  logger?: AuditLogger;
}

export interface AgentIdentityModuleAsyncOptions {
  imports?: unknown[];
  useFactory: (...args: unknown[]) => AgentIdentityModuleOptions | Promise<AgentIdentityModuleOptions>;
  inject?: unknown[];
}

export const AGENT_IDENTITY_OPTIONS = 'AGENT_IDENTITY_OPTIONS';

@Module({})
export class AgentIdentityModule {
  static forRoot(options: AgentIdentityModuleOptions): DynamicModule {
    return {
      module: AgentIdentityModule,
      providers: [
        { provide: AGENT_IDENTITY_OPTIONS, useValue: options },
        AgentIdentityService,
      ],
      exports: [AgentIdentityService],
      global: true,
    };
  }

  static forRootAsync(options: AgentIdentityModuleAsyncOptions): DynamicModule {
    return {
      module: AgentIdentityModule,
      imports: (options.imports ?? []) as Parameters<typeof Module>[0]['imports'],
      providers: [
        {
          provide: AGENT_IDENTITY_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never[],
        },
        AgentIdentityService,
      ],
      exports: [AgentIdentityService],
      global: true,
    };
  }
}
