import type { MigrationPhase, ProviderAdapter, ResolvedCredential, SupportedProvider } from './types';

/**
 * assertMigrationScope — validates that a resolved credential's scope is
 * compatible with the requested migration phase.
 *
 * Enforcement order:
 *   1. Explicit scope field (authoritative) — populated by the router from
 *      Credential.scope. Checked case-insensitively:
 *        read-only / readonly / read  → treats as read-only
 *        write / read/write / readwrite → treats as write-capable
 *   2. Ref-string heuristic (fallback) — fires when credential.scope is absent.
 *      Checks whether the ref contains 'readonly' or ends with '-ro'.
 *      This is a naming convention, not a cryptographic guarantee.
 *      Error messages nudge callers to set Credential.scope instead.
 *
 * Called by every ProviderAdapter.validateForMigration() implementation.
 */
function assertMigrationScope(
  credential: ResolvedCredential,
  phase: MigrationPhase,
  adapterId: SupportedProvider
): void {
  const writePhases: MigrationPhase[] = ['load', 'rollback'];

  // ── Path 1: explicit scope field (authoritative) ────────────────────────
  if (credential.scope !== undefined) {
    const s = credential.scope.toLowerCase();
    const isExplicitlyReadOnly =
      s === 'read' || s.includes('read-only') || s.includes('readonly');
    const isExplicitlyWritable =
      s.includes('write') || s.includes('read/write') || s.includes('readwrite');

    if (writePhases.includes(phase) && isExplicitlyReadOnly) {
      throw new Error(
        `[${adapterId}] Migration phase "${phase}" requires a write-scoped credential, ` +
        `but credential scope "${credential.scope}" is read-only.`
      );
    }
    if (phase === 'dry-run' && isExplicitlyWritable) {
      console.warn(
        `[${adapterId}] dry-run received write-capable credential ` +
        `(scope: "${credential.scope}"). Ensure the operation is truly read-only.`
      );
    }
    // Scope field is authoritative — no further heuristics needed.
    return;
  }

  // ── Path 2: ref-string naming heuristic fallback ────────────────────────
  // Note: naming conventions are not a cryptographic guarantee.
  // Set Credential.scope for explicit, authoritative enforcement.
  const readOnlyRef =
    credential.ref.toLowerCase().includes('readonly') ||
    credential.ref.endsWith('-ro');

  if (writePhases.includes(phase) && readOnlyRef) {
    throw new Error(
      `[${adapterId}] Migration phase "${phase}" requires a write-scoped credential, ` +
      `but ref "${credential.ref}" appears read-only ` +
      `(naming heuristic — set Credential.scope for authoritative enforcement).`
    );
  }
  if (phase === 'dry-run' && !readOnlyRef) {
    console.warn(
      `[${adapterId}] dry-run received potentially write-capable ref ` +
      `"${credential.ref}". Ensure dryRun:true is enforced. ` +
      `Set Credential.scope for explicit enforcement.`
    );
  }
}

const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  injectCredential(request, credential) {
    return { ...request, user: credential.resolvedFor, _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'Authorization: Bearer header (server-side)' } };
  },
  validate(request) {
    if (!request.model) throw new Error('[openai] request.model is required');
  },
  validateForMigration(credential, phase) { assertMigrationScope(credential, phase, 'openai'); },
};

const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  injectCredential(request, credential) {
    return { ...request, metadata: { ...(request.metadata as Record<string, unknown>), user_id: credential.resolvedFor, _agentIdentityMeta: { credentialRef: credential.ref, injectionPoint: 'x-api-key header (server-side)' } } };
  },
  validate(request) {
    if (!request.model) throw new Error('[anthropic] request.model is required');
    if (!request.messages) throw new Error('[anthropic] request.messages is required');
  },
  validateForMigration(credential, phase) { assertMigrationScope(credential, phase, 'anthropic'); },
};

const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  injectCredential(request, credential) {
    return { ...request, labels: { ...(request.labels as Record<string, unknown>), user_id: credential.resolvedFor }, _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'x-goog-api-key header (server-side)' } };
  },
  validate(request) {
    if (!request.contents) throw new Error('[gemini] request.contents is required');
  },
  validateForMigration(credential, phase) { assertMigrationScope(credential, phase, 'gemini'); },
};

const mistralAdapter: ProviderAdapter = {
  id: 'mistral',
  label: 'Mistral',
  injectCredential(request, credential) {
    return { ...request, _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'Authorization: Bearer header (server-side)' } };
  },
  validate(request) {
    if (!request.model) throw new Error('[mistral] request.model is required');
    if (!request.messages) throw new Error('[mistral] request.messages is required');
  },
  validateForMigration(credential, phase) { assertMigrationScope(credential, phase, 'mistral'); },
};

const localAdapter: ProviderAdapter = {
  id: 'local',
  label: 'Local / self-hosted',
  injectCredential(request, credential) {
    return { ...request, _agentIdentityMeta: { credentialRef: credential.ref, resolvedFor: credential.resolvedFor, injectionPoint: 'varies by runtime' } };
  },
  validateForMigration(credential, phase) { assertMigrationScope(credential, phase, 'local'); },
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

/**
 * Registry pattern — register a custom provider adapter without forking core.
 * Registered adapters are available via getAdapter() immediately.
 *
 * Example:
 *   import { registerProvider } from '@datacules/agent-identity';
 *   registerProvider({ id: 'cohere' as SupportedProvider, label: 'Cohere', injectCredential: ... });
 */
export function registerProvider(adapter: ProviderAdapter): void {
  (PROVIDER_ADAPTERS as Record<string, ProviderAdapter>)[adapter.id] = adapter;
}
