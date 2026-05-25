/**
 * Provider adapters — core publishable package.
 * Identical logic to src/lib/providers.ts.
 */
import type {
  MigrationPhase,
  ProviderAdapter,
  ResolvedCredential,
  SupportedProvider,
} from './types';

function assertMigrationScope(
  credential: ResolvedCredential,
  phase: MigrationPhase,
  adapterId: SupportedProvider
): void {
  const writePhases: MigrationPhase[] = ['load', 'rollback'];
  const readOnlyRef = credential.ref.includes('readonly') || credential.ref.endsWith('-ro');

  if (writePhases.includes(phase) && readOnlyRef) {
    throw new Error(
      `[${adapterId}] Migration phase "${phase}" requires a write-scoped credential, ` +
        `but credential ref "${credential.ref}" appears to be read-only.`
    );
  }

  if (phase === 'dry-run' && !readOnlyRef) {
    console.warn(
      `[${adapterId}] dry-run phase received a potentially write-capable credential ref "${credential.ref}". ` +
        'Ensure dryRun:true is enforced in the routing rule.'
    );
  }
}

const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  injectCredential(request, credential) {
    return {
      ...request,
      user: credential.resolvedFor,
      _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'Authorization: Bearer header (server-side)' },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[openai] request.model is required');
  },
  validateForMigration(credential, phase) {
    assertMigrationScope(credential, phase, 'openai');
  },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request, credential) {
    return {
      ...request,
      metadata: {
        ...(request.metadata as Record<string, unknown>),
        user_id: credential.resolvedFor,
        _agentIdentityMeta: { credentialRef: credential.ref, injectionPoint: 'x-api-key header (server-side)' },
      },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[anthropic] request.model is required');
    if (!request.messages) throw new Error('[anthropic] request.messages is required');
  },
  validateForMigration(credential, phase) {
    assertMigrationScope(credential, phase, 'anthropic');
  },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request, credential) {
    return {
      ...request,
      labels: { ...(request.labels as Record<string, unknown>), user_id: credential.resolvedFor },
      _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'x-goog-api-key header (server-side)' },
    };
  },
  validate(request) {
    if (!request.contents) throw new Error('[gemini] request.contents is required');
  },
  validateForMigration(credential, phase) {
    assertMigrationScope(credential, phase, 'gemini');
  },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request, credential) {
    return {
      ...request,
      _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'Authorization: Bearer header (server-side)' },
    };
  },
  validate(request) {
    if (!request.model) throw new Error('[mistral] request.model is required');
    if (!request.messages) throw new Error('[mistral] request.messages is required');
  },
  validateForMigration(credential, phase) {
    assertMigrationScope(credential, phase, 'mistral');
  },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request, credential) {
    return {
      ...request,
      _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'varies by runtime' },
    };
  },
  validateForMigration(credential, phase) {
    assertMigrationScope(credential, phase, 'local');
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
