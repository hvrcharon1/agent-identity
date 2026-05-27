/**
 * Re-export from packages/core/src/approval.ts for use in Next.js API routes.
 *
 * The Next.js app imports from @/lib/* rather than reaching into packages/core
 * directly, so this shim keeps API routes clean while the source of truth
 * remains in packages/core.
 */
export { ApprovalManager, MemoryApprovalStore, WebhookApprovalNotifier, SlackApprovalNotifier } from '../../packages/core/src/approval';
export type { ApprovalStore, ApprovalNotifier } from '../../packages/core/src/approval';
