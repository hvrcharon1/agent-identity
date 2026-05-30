/**
 * nestjs.test.ts
 *
 * Vitest test suite for AgentIdentityService and AgentIdentityGuard from
 * @datacules/agent-identity-nestjs.
 *
 * NestJS decorators (@Injectable, @Inject, CanActivate, ExecutionContext,
 * ForbiddenException, createParamDecorator) are mocked via vi.mock() so no
 * @nestjs/common runtime is needed. The service and guard are instantiated
 * directly with the AGENT_IDENTITY_OPTIONS injection token pattern.
 *
 * 12 test cases:
 *   AgentIdentityService.resolve() (4): fixed cred, resolvedFor, user-delegated, null on no match
 *   AgentIdentityService.resolveAsync() (2): resolves via async path, null on no match
 *   AgentIdentityService.resolvePairAsync() (2): returns pair, null on no match
 *   AgentIdentityGuard.canActivate() (3): pass-through, attach + true, ForbiddenException
 *   AgentIdentityGuard.extractContext() (2): reads body.agentContext, null when body absent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Credential, RoutingRule } from '@datacules/agent-identity';

// ─── Mock @nestjs/common ──────────────────────────────────────────────────────
// NestJS decorators are applied at class definition time. We stub them before
// importing the NestJS source files so the decorator factories are in place.

vi.mock('@nestjs/common', () => ({
  Injectable: () => () => undefined,
  Inject: () => () => undefined,
  Module: () => () => undefined,
  CanActivate: class {},
  ForbiddenException: class ForbiddenException extends Error {
    constructor(message: string) { super(message); this.name = 'ForbiddenException'; }
  },
  ExecutionContext: class {},
  createParamDecorator: (_fn: unknown) => () => undefined,
}));

// ─── Import under-test modules (after mock is hoisted) ────────────────────────
import { AgentIdentityService } from './AgentIdentityService';
import { AgentIdentityGuard, RESOLVED_CREDENTIAL_KEY } from './AgentIdentityGuard';
import { AGENT_IDENTITY_OPTIONS } from './AgentIdentityModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXED_CREDENTIAL: Credential = {
  id: 'cred-openai-fixed',
  kind: 'fixed',
  name: 'OpenAI Prod Key',
  scope: 'read write',
  status: 'active',
  provider: 'openai',
  ref: 'openai-prod-key',
};

const USER_DELEGATED_CREDENTIAL: Credential = {
  id: 'cred-anthropic-user',
  kind: 'user-delegated',
  name: 'Anthropic User Token',
  scope: 'read',
  status: 'active',
  provider: 'anthropic',
  ref: 'anthropic-user-token',
};

const RULES: RoutingRule[] = [
  {
    id: 'rule-openai-shared',
    credentialRef: 'openai-prod-key',
    priority: 10,
    matchProvider: 'openai',
    matchResourceKind: 'shared',
  },
  {
    id: 'rule-anthropic-personal',
    credentialRef: 'anthropic-user-token',
    priority: 20,
    matchProvider: 'anthropic',
    matchResourceKind: 'personal',
  },
];

const SOURCE_RULE: RoutingRule = {
  id: 'rule-source',
  credentialRef: 'openai-prod-key',
  priority: 10,
  matchProvider: 'openai',
  matchPhase: 'extract',
  matchResourceKind: 'shared',
};

const TARGET_RULE: RoutingRule = {
  id: 'rule-target',
  credentialRef: 'anthropic-user-token',
  priority: 10,
  matchProvider: 'anthropic',
  matchPhase: 'load',
  matchResourceKind: 'shared',
};

const BASE_CONTEXT = {
  userId: 'user-123',
  resourceId: 'res-abc',
  resourceKind: 'shared' as const,
  provider: 'openai' as const,
  model: 'gpt-4',
  action: 'complete',
  traceId: 'trace-001',
  requestedAt: new Date().toISOString(),
};

const MIGRATION_CONTEXT = {
  userId: 'user-123',
  resourceId: 'res-abc',
  resourceKind: 'shared' as const,
  provider: 'openai' as const,
  model: 'gpt-4',
  action: 'migrate',
  traceId: 'trace-002',
  requestedAt: new Date().toISOString(),
  migrationId: 'mig-001',
  phase: 'extract' as const,
  sourceResourceId: 'res-source',
  targetResourceId: 'res-target',
  batchIndex: 0,
  totalBatches: 1,
  dryRun: false,
};

// ─── Service factory ──────────────────────────────────────────────────────────

function makeService(options: {
  credentials: Credential[];
  rules: RoutingRule[];
}) {
  // AgentIdentityService reads options from the AGENT_IDENTITY_OPTIONS injection
  // token. We bypass NestJS DI by directly instantiating with the options object.
  // The @Inject decorator is mocked to a no-op, so the constructor receives
  // the options normally when called with new.
  return new AgentIdentityService(options as any);
}

// ─── ExecutionContext mock helper ─────────────────────────────────────────────

function makeExecutionContext(body?: Record<string, unknown>) {
  const request = body !== undefined ? { body } : {};
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentIdentityService', () => {

  describe('resolve()', () => {
    it('returns a ResolvedCredential with correct credentialId on match', () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      const result = svc.resolve(BASE_CONTEXT);

      expect(result).not.toBeNull();
      expect(result!.credentialId).toBe('cred-openai-fixed');
    });

    it('sets resolvedFor to "service" for fixed credentials', () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      const result = svc.resolve(BASE_CONTEXT);

      expect(result!.kind).toBe('fixed');
      expect(result!.resolvedFor).toBe('service');
    });

    it('sets resolvedFor to ctx.userId for user-delegated credentials', () => {
      const svc = makeService({
        credentials: [FIXED_CREDENTIAL, USER_DELEGATED_CREDENTIAL],
        rules: RULES,
      });
      const anthropicCtx = {
        ...BASE_CONTEXT,
        provider: 'anthropic' as const,
        resourceKind: 'personal' as const,
      };
      const result = svc.resolve(anthropicCtx);

      expect(result!.kind).toBe('user-delegated');
      expect(result!.resolvedFor).toBe('user-123');
    });

    it('returns null when no routing rule matches the context', () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      const geminiCtx = { ...BASE_CONTEXT, provider: 'gemini' as const };
      const result = svc.resolve(geminiCtx);

      expect(result).toBeNull();
    });
  });

  describe('resolveAsync()', () => {
    it('returns the same result as resolve() via the async path', async () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      const result = await svc.resolveAsync(BASE_CONTEXT);

      expect(result).not.toBeNull();
      expect(result!.credentialId).toBe('cred-openai-fixed');
      expect(result!.resolvedFor).toBe('service');
    });

    it('returns null when no routing rule matches', async () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      const geminiCtx = { ...BASE_CONTEXT, provider: 'gemini' as const };
      const result = await svc.resolveAsync(geminiCtx);

      expect(result).toBeNull();
    });
  });

  describe('resolvePairAsync()', () => {
    it('returns a ResolvedCredentialPair with source, target, and migrationId', async () => {
      const svc = makeService({
        credentials: [FIXED_CREDENTIAL, USER_DELEGATED_CREDENTIAL],
        rules: [SOURCE_RULE, TARGET_RULE],
      });
      const migCtx = {
        ...MIGRATION_CONTEXT,
        // source context resolves via openai/extract rule
        provider: 'openai' as const,
      };

      // For resolvePairAsync the router resolves source (phase=extract/openai)
      // and target (phase=load/anthropic) separately. We need a context where
      // both source and target rules fire. Since the core router uses the same
      // context for both lookups in resolvePair, and our two rules match on
      // different phases and providers, we verify the pair call itself returns
      // a non-null result by using rules that both match the migration context.
      const sharedMigRules: RoutingRule[] = [
        {
          id: 'rule-source-shared',
          credentialRef: 'openai-prod-key',
          priority: 10,
          matchProvider: 'openai',
          matchResourceKind: 'shared',
        },
        {
          id: 'rule-target-shared',
          credentialRef: 'anthropic-user-token',
          priority: 5,
          matchProvider: 'openai',
          matchResourceKind: 'shared',
        },
      ];
      const svc2 = makeService({
        credentials: [FIXED_CREDENTIAL, USER_DELEGATED_CREDENTIAL],
        rules: sharedMigRules,
      });
      const result = await svc2.resolvePairAsync(MIGRATION_CONTEXT);

      expect(result).not.toBeNull();
      expect(result!.migrationId).toBe('mig-001');
      expect(result!.source).toBeDefined();
      expect(result!.target).toBeDefined();
    });

    it('returns null when no rule matches the migration context', async () => {
      const svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
      // gemini context matches no rule
      const geminiMigCtx = { ...MIGRATION_CONTEXT, provider: 'gemini' as const };
      const result = await svc.resolvePairAsync(geminiMigCtx);

      expect(result).toBeNull();
    });
  });
});

describe('AgentIdentityGuard', () => {
  let svc: AgentIdentityService;
  let guard: AgentIdentityGuard;

  beforeEach(() => {
    svc = makeService({ credentials: [FIXED_CREDENTIAL], rules: RULES });
    guard = new AgentIdentityGuard(svc);
  });

  describe('canActivate()', () => {
    it('returns true without attaching credential when no agentContext in body', async () => {
      const ctx = makeExecutionContext({ otherField: 'value' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await guard.canActivate(ctx as any);

      expect(result).toBe(true);
      // No RESOLVED_CREDENTIAL_KEY on the request
      const request = ctx.switchToHttp().getRequest();
      expect((request as Record<string, unknown>)[RESOLVED_CREDENTIAL_KEY]).toBeUndefined();
    });

    it('returns true and attaches resolvedCredential to request on successful resolution', async () => {
      const ctx = makeExecutionContext({ agentContext: BASE_CONTEXT });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await guard.canActivate(ctx as any);

      expect(result).toBe(true);
      const request = ctx.switchToHttp().getRequest();
      const attached = (request as Record<string, unknown>)[RESOLVED_CREDENTIAL_KEY] as any;
      expect(attached).toBeDefined();
      expect(attached.credentialId).toBe('cred-openai-fixed');
    });

    it('throws ForbiddenException when resolveAsync() returns null', async () => {
      const ctx = makeExecutionContext({
        agentContext: { ...BASE_CONTEXT, provider: 'gemini' as const },
      });

      // The guard throws new ForbiddenException('agent-identity: no credential matched...').
      // toThrow('ForbiddenException') would match against the message string and fail
      // because the message is the guard's description, not the class name.
      // toMatchObject({ name: 'ForbiddenException' }) checks the name property set by
      // the vi.mock() stub (this.name = 'ForbiddenException'), which is the correct
      // assertion for verifying the exception type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(guard.canActivate(ctx as any)).rejects.toMatchObject({ name: 'ForbiddenException' });
    });
  });

  describe('extractContext()', () => {
    it('returns the agentContext object from request.body', () => {
      const request = { body: { agentContext: BASE_CONTEXT } };
      // extractContext is protected — access via type cast for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (guard as any).extractContext(request);

      expect(result).toEqual(BASE_CONTEXT);
    });

    it('returns null when request.body is absent', () => {
      const request = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (guard as any).extractContext(request);

      expect(result).toBeNull();
    });
  });
});
