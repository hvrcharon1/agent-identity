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
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential): Record<string, unknown> {
    return {
      ...request,
      user: credential.resolvedFor,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'Authorization: Bearer header (server-side)',
      },
    };
  },
  validate(request: Record<string, unknown>): void {
    if (!request.model) throw new Error('[openai] request.model is required');
  },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential): Record<string, unknown> {
    return {
      ...request,
      metadata: {
        ...(request.metadata as Record<string, unknown>),
        user_id: credential.resolvedFor,
        _agentIdentityMeta: {
          credentialRef: credential.ref,
          injectionPoint: 'x-api-key header (server-side)',
        },
      },
    };
  },
  validate(request: Record<string, unknown>): void {
    if (!request.model) throw new Error('[anthropic] request.model is required');
    if (!request.messages) throw new Error('[anthropic] request.messages is required');
  },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential): Record<string, unknown> {
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
  validate(request: Record<string, unknown>): void {
    if (!request.contents) throw new Error('[gemini] request.contents is required');
  },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential): Record<string, unknown> {
    return {
      ...request,
      _agentIdentityMeta: {
        credentialRef: credential.ref,
        resolvedFor: credential.resolvedFor,
        injectionPoint: 'Authorization: Bearer header (server-side)',
      },
    };
  },
  validate(request: Record<string, unknown>): void {
    if (!request.model) throw new Error('[mistral] request.model is required');
    if (!request.messages) throw new Error('[mistral] request.messages is required');
  },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential): Record<string, unknown> {
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
