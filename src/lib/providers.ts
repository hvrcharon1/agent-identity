import type { ProviderAdapter, ResolvedCredential, SupportedProvider } from './types';

/**
 * Provider adapters normalize how a resolved credential is injected
 * into each AI provider's request format.
 *
 * SECURITY: These adapters receive a credential *reference*, not the
 * raw secret. Your credential vault resolves the ref → actual secret
 * server-side and injects it here. Never log resolved secrets.
 */

const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  injectCredential(request, credential) {
    // Attach user identity as a metadata field for audit
    return {
      ...request,
      user: credential.resolvedFor,
      // In production: Authorization header is set server-side from credential.ref
      _credentialRef: credential.ref,
    };
  },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request, credential) {
    return {
      ...request,
      metadata: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(request.metadata as any),
        user_id: credential.resolvedFor,
        credential_ref: credential.ref,
      },
    };
  },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request, credential) {
    return {
      ...request,
      generationConfig: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(request.generationConfig as any),
      },
      // Credential injected via server-side header resolution
      _meta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor },
    };
  },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request, credential) {
    return {
      ...request,
      _meta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor },
    };
  },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request, credential) {
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
