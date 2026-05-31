/**
 * @datacules/agent-identity-token-exchange
 *
 * RFC 8693 OAuth 2.0 Token Exchange CredentialStore for @datacules/agent-identity.
 *
 * Exchanges a user's existing access/ID token for a scoped downstream token
 * at any OAuth 2.0 Authorization Server that implements RFC 8693:
 *   - Keycloak (all versions with token-exchange feature enabled)
 *   - Auth0 (Enterprise — token exchange extension)
 *   - Azure AD / Entra ID (On-Behalf-Of flow, OBO)
 *   - Okta (Token Exchange / act-as)
 *   - Any AS that supports the token-exchange grant type
 *
 * @example
 * ```typescript
 * import { TokenExchangeStore } from '@datacules/agent-identity-token-exchange';
 * import { createRouterFromStore } from '@datacules/agent-identity';
 *
 * // In your API route handler:
 * const subjectToken = req.headers.authorization?.replace('Bearer ', '');
 *
 * const store = new TokenExchangeStore({
 *   configs: [
 *     {
 *       ref: 'crm-service-token',
 *       name: 'CRM Service Token',
 *       kind: 'user-delegated',
 *       scope: 'crm:read crm:write',
 *       status: 'active',
 *       tokenEndpoint: 'https://auth.example.com/realms/acme/protocol/openid-connect/token',
 *       clientId: 'agent-identity-client',
 *       clientSecret: process.env.AGENT_CLIENT_SECRET!,
 *       requestedScopes: ['crm:read', 'crm:write'],
 *       audience: 'https://crm.example.com',
 *     },
 *   ],
 *   subjectTokenProvider: async (_ref) => subjectToken ?? null,
 * });
 *
 * const router = createRouterFromStore(store, rules);
 * const resolved = await router.resolveAsync(ctx);
 * // resolved.ref is the exchanged access_token — injected server-side,
 * // never returned to the client or the model layer.
 * ```
 */
export { TokenExchangeStore } from './TokenExchangeStore';
export type {
  TokenExchangeConfig,
  TokenExchangeResponse,
  TokenExchangeStoreOptions,
  SubjectTokenProvider,
  RfcTokenType,
} from './types';
export { RFC_TOKEN_TYPES } from './types';
