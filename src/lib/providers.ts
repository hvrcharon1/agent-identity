import type { ProviderAdapter, ResolvedCredential, SupportedProvider } from './types';

const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    return {
      ...request,
      user: credential.resolvedFor,
      _credentialRef: credential.ref,
    };
  },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    return {
      ...request,
      metadata: {
        ...(request.metadata as Record<string, unknown>),
        user_id: credential.resolvedFor,
        credential_ref: credential.ref,
      },
    };
  },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    return {
      ...request,
      generationConfig: {
        ...(request.generationConfig as Record<string, unknown>),
      },
      _meta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor },
    };
  },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    return {
      ...request,
      _meta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor },
    };
  },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request: Record<string, unknown>, credential: ResolvedCredential) {
    return {
      ...request,
      _meta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor },
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
