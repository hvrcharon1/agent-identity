/**
 * Re-export from packages/core/src/approval.ts for use in Next.js API routes.
 */
export { ApprovalManager, MemoryApprovalStore, WebhookApprovalNotifier, SlackApprovalNotifier } from '../../packages/core/src/approval';
export type { ApprovalStore, ApprovalNotifier } from '../../packages/core/src/approval';
