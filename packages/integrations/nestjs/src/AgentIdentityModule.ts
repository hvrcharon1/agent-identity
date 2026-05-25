/**
 * AgentIdentityModule — NestJS DynamicModule exposing AgentIdentityService.
 *
 * Use forRoot() for synchronous configuration (in-memory credentials).
 * Use forRootAsync() for async configuration (e.g. loading secrets from Vault at startup).
 *
 * forRoot() example:
 *
 *   AgentIdentityModule.forRoot({
 *     credentials: myCredentials,
 *     rules: myRules,
 *   })
 *
 * forRootAsync() example:
 *
 *   AgentIdentityModule.forRootAsync({
 *     useFactory: async (configService: ConfigService) => ({
 *       store: new AwsCredentialStore(),
 *       rules: configService.get('ROUTING_RULES'),
 *     }),
 *     inject: [ConfigService],
 *   })
 */
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AgentIdentityService, AgentIdentityModuleOptions } from './AgentIdentityService';

const AGENT_IDENTITY_OPTIONS = 'AGENT_IDENTITY_OPTIONS';

export interface AgentIdentityAsyncOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => Promise<AgentIdentityModuleOptions> | AgentIdentityModuleOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  imports?: DynamicModule['imports'];
}

@Module({})
export class AgentIdentityModule {
  static forRoot(options: AgentIdentityModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: AGENT_IDENTITY_OPTIONS,
      useValue: options,
    };
    const serviceProvider: Provider = {
      provide: AgentIdentityService,
      useFactory: (opts: AgentIdentityModuleOptions) => new AgentIdentityService(opts),
      inject: [AGENT_IDENTITY_OPTIONS],
    };
    return {
      module: AgentIdentityModule,
      providers: [optionsProvider, serviceProvider],
      exports: [AgentIdentityService],
    };
  }

  static forRootAsync(asyncOptions: AgentIdentityAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: AGENT_IDENTITY_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };
    const serviceProvider: Provider = {
      provide: AgentIdentityService,
      useFactory: (opts: AgentIdentityModuleOptions) => new AgentIdentityService(opts),
      inject: [AGENT_IDENTITY_OPTIONS],
    };
    return {
      module: AgentIdentityModule,
      imports: asyncOptions.imports ?? [],
      providers: [optionsProvider, serviceProvider],
      exports: [AgentIdentityService],
    };
  }
}
