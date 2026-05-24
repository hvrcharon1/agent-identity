/**
 * Provider adapters — inject resolved credentials into provider-specific requests.
 *
 * Finding #12: Fixed hollow Gemini/Mistral/local adapters with correct injection
 * points and explicit TODO comments. Added optional validate() to the interface.
 */
import type { ProviderAdapter, ResolvedCredential, SupportedProvider } from './types';

const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    // OpenAI: `user` field is the correct place for per-user tracking (abuse prevention).
    // API key goes in Authorization: Bearer header — set server-side, never here.
    return {
      ...request,
      user: credential.resolvedFor,
      // _credentialRef is for server-side logging only — strip before sending to OpenAI
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'Authorization: Bearer header (server-side)',
      },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[openai] request.model is required');
  },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    // Anthropic: metadata.user_id is the correct field for per-user audit.
    // API key goes in x-api-key header — set server-side only.
    return {
      ...request,
      metadata: {
        ...(request.metadata as Record<string, unknown>),
        user_id: credential.resolvedFor,
        // credential_ref is for server-side logging — strip before sending to Anthropic
        _agentIdentityMeta: {
          credentialRef: credential.ref,
          injectionPoint: 'x-api-key header (server-side)',
        },
      },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[anthropic] request.model is required');
    if (!request.messages) throw new Error('[anthropic] request.messages is required');
  },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    // TODO: Real Gemini auth — API key goes in `x-goog-api-key` header (server-side only).
    // The generationConfig body field does NOT carry auth.
    // For user tracking: add request.labels = { user_id: credential.resolvedFor }
    return {
      ...request,
      labels: {
        ...(request.labels as Record<string, unknown>),
        user_id: credential.resolvedFor,
      },
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'x-goog-api-key header (server-side)',
      },
    };
  },
  validate(request) {
    if (!request.contents) throw new Error('[gemini] request.contents is required');
  },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    // TODO: Real Mistral auth — API key goes in Authorization: Bearer header (server-side).
    // Mistral does not currently have a first-class user-tracking field.
    // Best practice: log credential.resolvedFor server-side against the request ID.
    return {
      ...request,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'Authorization: Bearer header (server-side)',
      },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[mistral] request.model is required');
    if (!request.messages) throw new Error('[mistral] request.messages is required');
  },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    // TODO: Auth mechanism depends on your self-hosted setup (Ollama, vLLM, LM Studio).
    // Common options:
    //   - Ollama: no auth by default; use network-level controls
    //   - vLLM: optional API key via --api-key flag; inject in Authorization: Bearer header
    //   - LM Studio: basic auth or API key depending on version
    // Track user server-side via your own middleware.
    return {
      ...request,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'varies by runtime — see TODO comment',
      },
    };
  },
};

export const PROVIDER_ADAPTERS: Record<SupportedProvider, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  mistral: mistralAdapter,
  local: localAdapter,
};

export function getAdapter(provider: SupportedProvider): ProviderAdapter {
  return PROVIDER_ADAPTERS[provider];
}
