/**
 * @datacules/agent-identity-store-libsql
 *
 * LibSQL (SQLite / Turso) persistence layer for the agent-identity framework.
 *
 * Quick start:
 * ```typescript
 * import { createLibSqlStores } from '@datacules/agent-identity-store-libsql';
 * import { createRouterFromStore } from '@datacules/agent-identity';
 *
 * // Embedded — zero infra
 * const stores = await createLibSqlStores({ url: 'file:./agent-identity.db' });
 * const router = createRouterFromStore(stores.credentialStore, rules, stores.auditLogger);
 *
 * // Distributed — swap one URL, no code change
 * const stores = await createLibSqlStores({
 *   url: process.env.TURSO_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 * ```
 */

export { LibSqlCredentialStore } from './LibSqlCredentialStore.js';
export type { UpsertCredentialOptions } from './LibSqlCredentialStore.js';

export { LibSqlApprovalStore } from './LibSqlApprovalStore.js';

export { LibSqlBudgetStore } from './LibSqlBudgetStore.js';

export { LibSqlAuditLogger } from './LibSqlAuditLogger.js';

export {
  bootstrapSchema,
  createLibSqlStores,
  SCHEMA_DDL,
} from './schema.js';
export type { LibSqlStoreOptions, LibSqlStores } from './schema.js';
