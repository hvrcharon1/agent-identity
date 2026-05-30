/**
 * fastify.test.ts
 *
 * Vitest test suite for agentIdentityPlugin from
 * @datacules/agent-identity-fastify.
 *
 * Fastify uses `import type` for FastifyPluginAsync, FastifyRequest,
 * FastifyReply — type imports are erased at runtime.
 *
 * The preHandler hook under test is extracted by calling the plugin with
 * a minimal mock Fastify instance that captures decorateRequest and
 * addHook calls. This avoids requiring the fastify or fastify-plugin
 * runtime packages.
 *
 * 12 test cases:
 *   passThrough behavior (4): absent context passThrough true/false, 400 naming
 *   credential resolution (5): attach, resolvedFor, 403 on no match, 403 expired
 *   custom contextKey (2): reads correct field, 400 names custom key
 *   plugin registration (1): fastify-plugin wrapping verified
 */
import { describe, it, expect, vi } from 'vitest';
import { agentIdentityPlugin } from './index';
import type { Credential, RoutingRule } from '@datacules/agent-identity';

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

const EXPIRED_CREDENTIAL: Credential = {
  id: 'cred-expired',
  kind: 'fixed',
  name: 'Expired Key',
  scope: 'read write',
  status: 'active',
  provider: 'openai',
  ref: 'expired-key',
  expiresAt: new Date(Date.now() - 1_000).toISOString(),
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

const EXPIRED_RULES: RoutingRule[] = [
  {
    id: 'rule-expired',
    credentialRef: 'expired-key',
    priority: 5,
    matchProvider: 'openai',
    matchResourceKind: 'shared',
  },
];

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

// ─── Mock Fastify instance helpers ────────────────────────────────────────────

/**
 * Builds a minimal mock Fastify instance and calls the plugin's inner
 * function (the one wrapped by fastify-plugin) to capture the addHook
 * preHandler call. Returns the captured preHandler function so tests
 * can invoke it directly without running a real Fastify server.
 *
 * fastify-plugin sets [Symbol.for('skip-override')] = true and exposes
 * the original plugin via .default or the function itself — we access
 * the unwrapped function by checking for [Symbol.for('fastify.display-name')]
 * or falling back to calling the exported plugin directly.
 */
async function extractPreHandler(
  options: Parameters<typeof agentIdentityPlugin>[1]
): Promise<(request: Record<string, unknown>, reply: ReturnType<typeof makeReply>) => Promise<void>> {
  let capturedHook: ((req: unknown, reply: unknown) => Promise<void>) | null = null;

  const mockFastify = {
    decorateRequest: vi.fn(),
    addHook: vi.fn((_hookName: string, fn: (req: unknown, reply: unknown) => Promise<void>) => {
      capturedHook = fn;
    }),
  };

  // agentIdentityPlugin is the fp()-wrapped plugin. fp() sets skip-override
  // and the wrapped function is stored on .default or exposed through the
  // Symbol-keyed property. We can call it directly — fp() returns a function
  // that accepts (fastify, options) just like the inner plugin, but also
  // skips Fastify's encapsulation. When called as a plain function it still
  // invokes the inner plugin body.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (agentIdentityPlugin as any)(mockFastify, options);

  if (!capturedHook) {
    throw new Error('addHook(preHandler) was not called by agentIdentityPlugin');
  }

  return capturedHook as (req: Record<string, unknown>, reply: ReturnType<typeof makeReply>) => Promise<void>;
}

function makeRequest(body?: Record<string, unknown>) {
  return { body, resolvedCredential: null } as Record<string, unknown>;
}

function makeReply() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  return { status, send };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agentIdentityPlugin', () => {

  // ─── Plugin registration ───────────────────────────────────────────────────

  describe('plugin registration', () => {
    it('is a fastify-plugin (has skip-override symbol set by fp())', () => {
      // fastify-plugin sets this symbol to true so Fastify does not create
      // a child scope — verifies fp() wrapping is in place
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((agentIdentityPlugin as any)[Symbol.for('skip-override')]).toBe(true);
    });
  });

  // ─── passThrough behavior ──────────────────────────────────────────────────

  describe('passThrough behavior', () => {
    it('does not call reply when agentContext is absent and passThrough=true (default)', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeRequest({ otherField: 'value' });
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('does not call reply when req.body is undefined and passThrough=true', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeRequest(undefined);
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('sends 400 when agentContext is absent and passThrough=false', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        passThrough: false,
      });
      const req = makeRequest({});
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it('400 error message names the missing contextKey', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        passThrough: false,
      });
      const req = makeRequest({});
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('agentContext') })
      );
    });
  });

  // ─── Credential resolution ─────────────────────────────────────────────────

  describe('credential resolution', () => {
    it('attaches resolvedCredential to request on successful resolution', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeRequest({ agentContext: BASE_CONTEXT });
      const reply = makeReply();

      await hook(req, reply);

      expect((req as Record<string, unknown>).resolvedCredential).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(((req as any).resolvedCredential as any)?.credentialId).toBe('cred-openai-fixed');
    });

    it('sets resolvedFor to "service" for fixed credentials', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeRequest({ agentContext: BASE_CONTEXT });
      const reply = makeReply();

      await hook(req, reply);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (req as any).resolvedCredential as any;
      expect(resolved?.kind).toBe('fixed');
      expect(resolved?.resolvedFor).toBe('service');
    });

    it('sets resolvedFor to ctx.userId for user-delegated credentials', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL, USER_DELEGATED_CREDENTIAL],
        rules: RULES,
      });
      const anthropicCtx = {
        ...BASE_CONTEXT,
        provider: 'anthropic' as const,
        resourceKind: 'personal' as const,
      };
      const req = makeRequest({ agentContext: anthropicCtx });
      const reply = makeReply();

      await hook(req, reply);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (req as any).resolvedCredential as any;
      expect(resolved?.kind).toBe('user-delegated');
      expect(resolved?.resolvedFor).toBe('user-123');
    });

    it('sends 403 when no routing rule matches the context', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      // gemini matches no configured rule
      const ctx = { ...BASE_CONTEXT, provider: 'gemini' as const };
      const req = makeRequest({ agentContext: ctx });
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('sends 403 when the matched credential is expired', async () => {
      const hook = await extractPreHandler({
        credentials: [EXPIRED_CREDENTIAL],
        rules: EXPIRED_RULES,
      });
      const req = makeRequest({ agentContext: BASE_CONTEXT });
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  // ─── Custom contextKey ─────────────────────────────────────────────────────

  describe('custom contextKey', () => {
    it('reads the agent context from the custom contextKey field', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        contextKey: 'identity',
      });
      const req = makeRequest({ identity: BASE_CONTEXT });
      const reply = makeReply();

      await hook(req, reply);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((req as any).resolvedCredential).toBeDefined();
    });

    it('400 error message names the custom contextKey when passThrough=false', async () => {
      const hook = await extractPreHandler({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        contextKey: 'identity',
        passThrough: false,
      });
      const req = makeRequest({});
      const reply = makeReply();

      await hook(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('identity') })
      );
    });
  });
});
