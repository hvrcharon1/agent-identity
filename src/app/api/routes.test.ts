/**
 * API Route Unit Tests (ISS-009)
 *
 * Tests all Next.js API route handlers by calling their exported functions
 * directly with mock Request objects. No live HTTP server is required.
 *
 * Coverage:
 *   GET  /api/health              (3 cases)
 *   POST /api/resolve             (4 cases)
 *   POST /api/approve             (5 cases)
 *   GET  /api/approve/:requestId  (2 cases)
 *   POST /api/approve/break-glass (3 cases)
 *   GET  /api/budget              (2 cases)
 *   POST /api/budget              (3 cases)
 *   POST /api/anomaly             (3 cases)
 *   DELETE /api/anomaly           (2 cases)
 *   POST /api/attest/sign         (2 cases)
 *   POST /api/attest              (2 cases)
 *
 * Total: 31 cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock server stores ─────────────────────────────────────────────────────

const mockCredentials = [
  {
    id: 'cred-openai-prod',
    kind: 'fixed' as const,
    name: 'OpenAI prod',
    scope: 'All projects - read/write',
    status: 'active' as const,
    provider: 'openai',
    ref: 'openai-prod-key',
  },
  {
    id: 'cred-anthropic-prod',
    kind: 'fixed' as const,
    name: 'Anthropic prod',
    scope: 'Read-only replica',
    status: 'active' as const,
    provider: 'anthropic',
    ref: 'anthropic-prod-key',
  },
];

const mockRules = [
  {
    id: 'rule-openai',
    description: 'Route openai to prod key',
    credentialRef: 'openai-prod-key',
    credentialKind: 'fixed' as const,
    priority: 10,
    matchProvider: 'openai' as const,
  },
  {
    id: 'rule-anthropic',
    description: 'Route anthropic to prod key',
    credentialRef: 'anthropic-prod-key',
    credentialKind: 'fixed' as const,
    priority: 10,
    matchProvider: 'anthropic' as const,
  },
];

const approvalStore = new Map<string, Record<string, unknown>>();
const budgetHourly = new Map<string, number>();

vi.mock('@/lib/server/credentialStore', () => ({
  getServerStore: vi.fn(async () => ({
    findByRef: async (ref: string) => mockCredentials.find((c) => c.ref === ref) ?? null,
    listActive: async () => mockCredentials,
    listByKind: async (kind: string) => mockCredentials.filter((c) => c.kind === kind),
  })),
  getServerRules: vi.fn(async () => mockRules),
  getServerApprovalStore: vi.fn(async () => ({
    get: async (id: string) => approvalStore.get(id) ?? null,
    create: async (req: Record<string, unknown>) => { approvalStore.set(req.requestId as string, req); },
    update: async (id: string, status: string, resolvedBy?: string, justification?: string) => {
      const existing = approvalStore.get(id);
      if (existing) {
        approvalStore.set(id, { ...existing, status, resolvedAt: new Date().toISOString(), resolvedBy, justification });
      }
    },
    listPending: async () => Array.from(approvalStore.values()).filter((r) => r.status === 'pending'),
  })),
  getServerBudgetStore: vi.fn(async () => ({
    getHourlyCount: async (id: string) => budgetHourly.get(id) ?? 0,
    getConcurrentSessions: async () => 0,
    getDailySpend: async () => 0,
    resetHourly: async (id: string) => { budgetHourly.delete(id); },
    resetDaily: async () => {},
    incrementHourlyCount: async (id: string) => {
      budgetHourly.set(id, (budgetHourly.get(id) ?? 0) + 1);
    },
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(method: string, url: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, init);
}

async function jsonResponse(response: Response) {
  return response.json();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const { GET } = await import('./health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.status).toBe('ok');
    expect(data.credentialsLoaded).toBe(2);
    expect(data.rulesLoaded).toBe(2);
  });

  it('includes a valid ISO timestamp', async () => {
    const { GET } = await import('./health/route');
    const res = await GET();
    const data = await jsonResponse(res);
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });

  it('includes version field', async () => {
    const { GET } = await import('./health/route');
    const res = await GET();
    const data = await jsonResponse(res);
    expect(data).toHaveProperty('version');
  });
});

describe('POST /api/resolve', () => {
  it('resolves an openai credential', async () => {
    const { POST } = await import('./resolve/route');
    const req = makeRequest('POST', '/api/resolve', {
      userId: 'user-alice',
      resourceId: 'project-a',
      resourceKind: 'shared',
      provider: 'openai',
      model: 'gpt-4o',
      action: 'read',
      traceId: 'trace-test-001',
      requestedAt: new Date().toISOString(),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.credentialId).toBe('cred-openai-prod');
  });

  it('returns 400 on missing required fields', async () => {
    const { POST } = await import('./resolve/route');
    const req = makeRequest('POST', '/api/resolve', { userId: 'user-alice' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const { POST } = await import('./resolve/route');
    const req = new Request('http://localhost:3000/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 when no rule matches', async () => {
    const { POST } = await import('./resolve/route');
    const req = makeRequest('POST', '/api/resolve', {
      userId: 'user-alice',
      resourceId: 'project-a',
      resourceKind: 'shared',
      provider: 'local',
      model: 'llama-3',
      action: 'read',
      traceId: 'trace-test-002',
      requestedAt: new Date().toISOString(),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/approve', () => {
  beforeEach(() => {
    approvalStore.clear();
    approvalStore.set('req-pending-1', {
      requestId: 'req-pending-1',
      credentialId: 'cred-openai-prod',
      ruleId: 'rule-openai',
      context: { userId: 'user-alice', resourceId: 'pii', action: 'write', provider: 'openai', traceId: 't-1' },
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  });

  it('approves a pending request', async () => {
    const { POST } = await import('./approve/route');
    const req = makeRequest('POST', '/api/approve', {
      requestId: 'req-pending-1',
      action: 'approve',
      resolvedBy: 'admin@acme.com',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.request.status).toBe('approved');
  });

  it('rejects a pending request', async () => {
    const { POST } = await import('./approve/route');
    const req = makeRequest('POST', '/api/approve', {
      requestId: 'req-pending-1',
      action: 'reject',
      justification: 'Denied by policy',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.request.status).toBe('rejected');
  });

  it('returns 404 for non-existent request', async () => {
    const { POST } = await import('./approve/route');
    const req = makeRequest('POST', '/api/approve', {
      requestId: 'req-nonexistent',
      action: 'approve',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });

  it('returns 409 for already resolved request', async () => {
    approvalStore.set('req-done', {
      requestId: 'req-done',
      status: 'approved',
    });
    const { POST } = await import('./approve/route');
    const req = makeRequest('POST', '/api/approve', {
      requestId: 'req-done',
      action: 'reject',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
  });

  it('returns 400 on invalid body', async () => {
    const { POST } = await import('./approve/route');
    const req = makeRequest('POST', '/api/approve', { action: 'invalid-action' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/approve/:requestId', () => {
  beforeEach(() => {
    approvalStore.clear();
    approvalStore.set('req-existing', { requestId: 'req-existing', status: 'pending' });
  });

  it('returns the request when it exists', async () => {
    const { GET } = await import('./approve/[requestId]/route');
    const req = new Request('http://localhost:3000/api/approve/req-existing');
    const res = await GET(req, { params: { requestId: 'req-existing' } } as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.request.requestId).toBe('req-existing');
  });

  it('returns 404 for missing request', async () => {
    const { GET } = await import('./approve/[requestId]/route');
    const req = new Request('http://localhost:3000/api/approve/nonexistent');
    const res = await GET(req, { params: { requestId: 'nonexistent' } } as any);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/approve/break-glass', () => {
  beforeEach(() => {
    approvalStore.clear();
    approvalStore.set('req-bg-1', {
      requestId: 'req-bg-1',
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  });

  it('performs break-glass override on a pending request', async () => {
    const { POST } = await import('./approve/break-glass/route');
    const req = makeRequest('POST', '/api/approve/break-glass', {
      requestId: 'req-bg-1',
      operator: 'emergency-admin',
      justification: 'Production outage requires immediate access',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.request.status).toBe('break_glass');
  });

  it('returns 404 for non-existent request', async () => {
    const { POST } = await import('./approve/break-glass/route');
    const req = makeRequest('POST', '/api/approve/break-glass', {
      requestId: 'req-nonexistent',
      operator: 'admin',
      justification: 'Emergency override needed',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when justification is too short', async () => {
    const { POST } = await import('./approve/break-glass/route');
    const req = makeRequest('POST', '/api/approve/break-glass', {
      requestId: 'req-bg-1',
      operator: 'admin',
      justification: 'short',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/budget', () => {
  beforeEach(() => {
    budgetHourly.clear();
    budgetHourly.set('cred-openai-prod', 42);
  });

  it('returns budget data for all credentials', async () => {
    const { GET } = await import('./budget/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.credentials).toHaveLength(2);
    expect(data.credentials[0].usage.hourlyCount).toBe(42);
  });

  it('returns zero counts when no budget usage exists', async () => {
    budgetHourly.clear();
    const { GET } = await import('./budget/route');
    const res = await GET();
    const data = await jsonResponse(res);
    expect(data.credentials[0].usage.hourlyCount).toBe(0);
  });
});

describe('POST /api/budget', () => {
  beforeEach(() => {
    budgetHourly.clear();
    budgetHourly.set('cred-openai-prod', 100);
  });

  it('resets hourly counter', async () => {
    const { POST } = await import('./budget/route');
    const req = makeRequest('POST', '/api/budget', {
      credentialId: 'cred-openai-prod',
      counter: 'hourly',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.counter).toBe('hourly');
    expect(budgetHourly.has('cred-openai-prod')).toBe(false);
  });

  it('resets daily counter', async () => {
    const { POST } = await import('./budget/route');
    const req = makeRequest('POST', '/api/budget', {
      credentialId: 'cred-openai-prod',
      counter: 'daily',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.counter).toBe('daily');
  });

  it('returns 400 on invalid counter value', async () => {
    const { POST } = await import('./budget/route');
    const req = makeRequest('POST', '/api/budget', {
      credentialId: 'cred-openai-prod',
      counter: 'weekly',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/anomaly', () => {
  it('returns success for valid observe request', async () => {
    const { POST } = await import('./anomaly/route');
    const req = makeRequest('POST', '/api/anomaly', {
      userId: 'user-alice',
      resourceId: 'project-a',
      resourceKind: 'shared',
      provider: 'openai',
      model: 'gpt-4o',
      action: 'read',
      traceId: 'trace-anom-001',
      requestedAt: new Date().toISOString(),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.anomalies).toEqual([]);
    expect(data.blocked).toBe(false);
  });

  it('returns 400 on missing required fields', async () => {
    const { POST } = await import('./anomaly/route');
    const req = makeRequest('POST', '/api/anomaly', { userId: 'user-alice' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const { POST } = await import('./anomaly/route');
    const req = new Request('http://localhost:3000/api/anomaly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'broken{json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/anomaly', () => {
  it('resets baseline for specified userId', async () => {
    const { DELETE } = await import('./anomaly/route');
    const req = new Request('http://localhost:3000/api/anomaly?userId=user-alice', { method: 'DELETE' });
    const res = await DELETE(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.ok).toBe(true);
    expect(data.reset).toBe('user-alice');
  });

  it('returns 400 when userId param is missing', async () => {
    const { DELETE } = await import('./anomaly/route');
    const req = new Request('http://localhost:3000/api/anomaly', { method: 'DELETE' });
    const res = await DELETE(req as any);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/attest/sign', () => {
  it('returns a token for valid input', async () => {
    const { POST } = await import('./attest/sign/route');
    const req = makeRequest('POST', '/api/attest/sign', {
      secret: 'test-secret-key-32-chars-minimum!',
      userId: 'user-alice',
      credentialId: 'cred-openai-prod',
      action: 'read',
      resourceId: 'project-a',
      traceId: 'trace-attest-001',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
  });

  it('returns error on missing secret', async () => {
    const { POST } = await import('./attest/sign/route');
    const req = makeRequest('POST', '/api/attest/sign', {
      userId: 'user-alice',
      credentialId: 'cred-openai-prod',
    });
    const res = await POST(req as any);
    expect([400, 500]).toContain(res.status);
  });
});

describe('POST /api/attest', () => {
  it('verifies a valid token', async () => {
    const { POST: signPost } = await import('./attest/sign/route');
    const secret = 'test-secret-key-32-chars-minimum!';
    const signReq = makeRequest('POST', '/api/attest/sign', {
      secret,
      userId: 'user-alice',
      credentialId: 'cred-openai-prod',
      action: 'read',
      resourceId: 'project-a',
      traceId: 'trace-attest-002',
    });
    const signRes = await signPost(signReq as any);
    const { token } = await jsonResponse(signRes);

    const { POST: verifyPost } = await import('./attest/route');
    const verifyReq = makeRequest('POST', '/api/attest', { token, secret });
    const verifyRes = await verifyPost(verifyReq as any);
    expect(verifyRes.status).toBe(200);
    const data = await jsonResponse(verifyRes);
    expect(data.valid).toBe(true);
  });

  it('rejects an invalid token', async () => {
    const { POST } = await import('./attest/route');
    const req = makeRequest('POST', '/api/attest', {
      token: 'eyJhbGciOiJIUzI1NiJ9.invalid.signature',
      secret: 'wrong-secret-key-for-verification!',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await jsonResponse(res);
    expect(data.valid).toBe(false);
  });
});
