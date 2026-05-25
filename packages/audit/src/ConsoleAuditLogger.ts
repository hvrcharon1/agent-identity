/**
 * ConsoleAuditLogger — pretty-prints AuditLogEntry to stdout.
 *
 * Designed for local development and CI environments.
 * Zero dependencies beyond the core package.
 *
 * Usage:
 *   import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';
 *   const router = createRouter(credentials, rules, new ConsoleAuditLogger());
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

export class ConsoleAuditLogger implements AuditLogger {
  constructor(
    private readonly prefix = '[agent-identity audit]',
    private readonly pretty = true
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const formatted = this.pretty
      ? JSON.stringify(entry, null, 2)
      : JSON.stringify(entry);
    console.log(this.prefix, formatted);
  }
}
