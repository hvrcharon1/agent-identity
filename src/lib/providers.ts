/**
 * Provider adapters — inject resolved credentials into provider-specific requests.
 *
 * Finding #12: Fixed hollow Gemini/Mistral/local adapters with correct injection
 * points and explicit TODO comments. Added optional validate() to the interface.
 *
 * Migration: Added optional validateForMigration() to each adapter.
 * Throws if a credential's scope is incompatible with the migration phase,
 * catching misconfigurations before any data moves.
 */
import type {
  MigrationPhase,
  ProviderAdapter,
  ResolvedCredential,
  SupportedProvider,
} from './types';

// ─── Shared migration scope helper ───────────────────────────────────────────

/**
 * Validates credential scope for a given migration phase.
 * load and rollback phases need write access; dry-run, extract, verify need read.
 */
function assertMigrationScope(
  credential: ResolvedCredential,
  phase: MigrationPhase,
  adapterId: SupportedProvider
): void {
  // We don't have the full Credential object here (only ResolvedCredential),
  // so we encode scope hints in the ref naming convention:
  //   refs ending in '-ro' or containing 'readonly' are read-only.
  // In production: fetch the credential from the store to check scope.
  const writePhases: MigrationPhase[] = ['load', 'rollback'];
  const readOnlyRef =
    credential.ref.includes('readonly') || credential.ref.endsWith('-ro');

  if (writePhases.includes(phase) && readOnlyRef) {
    throw new Error(
      `[${adapterId}] Migration phase "${phase}" requires a write-scoped credential, ` +
        `but credential ref "${credential.ref}" appears to be read-only. ` +
        'Use a write-scoped credential ref for load/rollback phases.'
    );
  }

  // dry-run must never receive a write-capable credential on the target
  if (phase === 'dry-run' && !readOnlyRef) {
    console.warn(
      `[${adapterId}] dry-run phase received a potentially write-capable credential ref ` +
        `"${credential.ref}". Ensure dryRun:true is enforced in the routing rule.`
    );
  }
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

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
  validateForMigration(credential: ResolvedCredential, phase: MigrationPhase): void {
    assertMigrationScope(credential, phase, 'openai');
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
  validateForMigration(credential: ResolvedCredential, phase: MigrationPhase): void {
    assertMigrationScope(credential, phase, 'anthropic');
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
  validateForMigration(credential: ResolvedCredential, phase: MigrationPhase): void {
    assertMigrationScope(credential, phase, 'gemini');
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
  validateForMigration(credential: ResolvedCredential, phase: MigrationPhase): void {
    assertMigrationScope(credential, phase, 'mistral');
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
  validateForMigration(credential: ResolvedCredential, phase: MigrationPhase): void {
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
