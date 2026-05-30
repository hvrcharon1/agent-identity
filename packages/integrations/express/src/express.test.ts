/**
 * express.test.ts
 *
 * Vitest test suite for agentIdentityMiddleware from
 * @datacules/agent-identity-express.
 *
 * Express uses `import type` for Request/Response/NextFunction — those imports
 * are erased at runtime, so no express runtime dependency is needed here.
 * req, res, and next are created as plain typed mock objects.
 *
 * 13 test cases:
 *   passThrough behavior (4): absent context + passThrough=true/false variants
 *   credential resolution (7): attach, next, resolvedFor, 403, expired, logger
 *   custom contextKey (2): reads correct field, 400 names custom key
 */
import { describe, it, expect, vi } from 'vitest';
import { agentIdentityMiddleware } from './index';
import type { Credential, RoutingRule } from '@datacules/agent-identity';

// ─── Fixtures ────────────────────────────────────────────────────────────────

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
  expiresAt: new Date(Date.now() - 1_000).toISOString(), // 1 second in the past
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

// ─── Mock helpers ─────────────────────────────────────────────────────────────

// req.body can be undefined (before express.json() middleware runs)
function makeReq(body?: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { body } as any;
}

// res.status(N).json(obj) — status() returns a plain object whose json property
// is the same vi.fn() exposed as res.json, so assertions on res.json capture
// all json() calls made through either the chained or direct path.
function makeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

function makeNext() {
  return vi.fn();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agentIdentityMiddleware', () => {

  // ─── passThrough behavior ──────────────────────────────────────────────────

  describe('passThrough behavior', () => {
    it('calls next() when agentContext is absent and passThrough=true (default)', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeReq({ otherField: 'value' });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() when req.body is undefined and passThrough=true', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeReq(undefined);
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('sends 400 when agentContext is absent and passThrough=false', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        passThrough: false,
      });
      const req = makeReq({});
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('400 error message names the missing contextKey', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        passThrough: false,
      });
      const req = makeReq({});
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      // res.status() returns { json: same-vi-fn }, so res.json captures the call
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('agentContext') })
      );
    });
  });

  // ─── Credential resolution ─────────────────────────────────────────────────

  describe('credential resolution', () => {
    it('attaches resolvedCredential to req on successful resolution', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeReq({ agentContext: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(req.resolvedCredential).toBeDefined();
      expect(req.resolvedCredential?.credentialId).toBe('cred-openai-fixed');
    });

    it('calls next() and sends no response on successful resolution', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeReq({ agentContext: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('sets resolvedFor to "service" for fixed credentials', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      const req = makeReq({ agentContext: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(req.resolvedCredential?.kind).toBe('fixed');
      expect(req.resolvedCredential?.resolvedFor).toBe('service');
    });

    it('sets resolvedFor to ctx.userId for user-delegated credentials', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL, USER_DELEGATED_CREDENTIAL],
        rules: RULES,
      });
      const anthropicCtx = {
        ...BASE_CONTEXT,
        provider: 'anthropic' as const,
        resourceKind: 'personal' as const,
      };
      const req = makeReq({ agentContext: anthropicCtx });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(req.resolvedCredential?.kind).toBe('user-delegated');
      expect(req.resolvedCredential?.resolvedFor).toBe('user-123');
    });

    it('sends 403 when no routing rule matches the context', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
      });
      // gemini matches no configured rule
      const ctx = { ...BASE_CONTEXT, provider: 'gemini' as const };
      const req = makeReq({ agentContext: ctx });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('sends 403 when the matched credential is expired', () => {
      const mw = agentIdentityMiddleware({
        credentials: [EXPIRED_CREDENTIAL],
        rules: EXPIRED_RULES,
      });
      const req = makeReq({ agentContext: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('invokes the audit logger when a credential resolves successfully', () => {
      const logger = { log: vi.fn() };
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        logger,
      });
      const req = makeReq({ agentContext: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      // logger.log() is called synchronously inside Promise.resolve(logger.log(entry))
      expect(logger.log).toHaveBeenCalledOnce();
    });
  });

  // ─── Custom contextKey ─────────────────────────────────────────────────────

  describe('custom contextKey', () => {
    it('reads the agent context from the custom contextKey field', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        contextKey: 'identity',
      });
      const req = makeReq({ identity: BASE_CONTEXT });
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(req.resolvedCredential).toBeDefined();
      expect(next).toHaveBeenCalledOnce();
    });

    it('400 error message names the custom contextKey when passThrough=false', () => {
      const mw = agentIdentityMiddleware({
        credentials: [FIXED_CREDENTIAL],
        rules: RULES,
        contextKey: 'identity',
        passThrough: false,
      });
      const req = makeReq({});
      const res = makeRes();
      const next = makeNext();

      mw(req, res as any, next); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('identity') })
      );
    });
  });
});
