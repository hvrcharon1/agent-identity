/**
 * @datacules/agent-identity-compliance
 *
 * Automated compliance report generation from agent-identity audit logs.
 * Answers regulatory questions directly — no custom queries needed.
 *
 * Supported report types:
 *   soc2   — SOC 2 CC6 Logical and Physical Access Controls
 *   gdpr   — GDPR Article 30 Records of Processing Activities
 *   hipaa  — HIPAA §164.312 Access Controls
 *
 * Usage:
 *   const generator = new ComplianceReportGenerator({ store });
 *   const report = await generator.generate({
 *     type: 'soc2',
 *     from: '2026-01-01T00:00:00Z',
 *     to: '2026-03-31T23:59:59Z',
 *   });
 */
import type { AuditLogEntry } from '@datacules/agent-identity';

// ─── Report types ────────────────────────────────────────────────────────────────

export type ReportType = 'soc2' | 'gdpr' | 'hipaa' | 'custom';

export interface ReportRequest {
  type: ReportType;
  /** ISO 8601 start of the reporting period */
  from: string;
  /** ISO 8601 end of the reporting period */
  to: string;
  /** Only include entries for these agent IDs (optional — all agents if omitted) */
  agentIds?: string[];
  /** Only include entries where resourceId tags include these tags (optional) */
  resourceTags?: string[];
  format?: 'json' | 'markdown';
}

export interface AgentAccessSummary {
  userId: string;
  credentialIds: string[];
  resourceIds: string[];
  actionCounts: Record<string, number>;
  resolutionCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CredentialRotationEntry {
  credentialId: string;
  rotatedAt: string;
  triggeredBy: string;
}

export interface AnomalyEventEntry {
  timestamp: string;
  userId: string;
  credentialId: string;
  signal: string;
  severity: string;
}

export interface OffHoursEntry {
  timestamp: string;
  userId: string;
  action: string;
  resourceId: string;
  credentialId: string;
}

export interface ComplianceReport {
  type: ReportType;
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  agentAccessSummary: AgentAccessSummary[];
  piiResourceAccess: AuditLogEntry[];
  offHoursAccess: OffHoursEntry[];
  credentialRotationHistory: CredentialRotationEntry[];
  anomalyEvents: AnomalyEventEntry[];
  totalEntries: number;
  summary: string;
}

// ─── Report Store ───────────────────────────────────────────────────────────────

export interface ReportStore {
  queryEntries(from: string, to: string): Promise<AuditLogEntry[]>;
}

/** In-memory store for testing — populate with entries from your audit sink */
export class MemoryReportStore implements ReportStore {
  constructor(private readonly entries: AuditLogEntry[]) {}

  async queryEntries(from: string, to: string): Promise<AuditLogEntry[]> {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return this.entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= start && t <= end;
    });
  }
}

// ─── Business hours helper ───────────────────────────────────────────────────────

function isOffHours(timestamp: string, startHour = 9, endHour = 18): boolean {
  const d = new Date(timestamp);
  const hour = d.getUTCHours();
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return true; // weekends
  return hour < startHour || hour >= endHour;
}

// ─── ComplianceReportGenerator ──────────────────────────────────────────────────

export interface ComplianceReportGeneratorConfig {
  store: ReportStore;
  /** Tags that identify PII resources (default: ['pii', 'phi', 'personal']) */
  piiTags?: string[];
  /** Business hours start (UTC, default: 9) */
  businessHoursStart?: number;
  /** Business hours end (UTC, default: 18) */
  businessHoursEnd?: number;
}

export class ComplianceReportGenerator {
  private readonly piiTags: string[];
  private readonly bhStart: number;
  private readonly bhEnd: number;

  constructor(private readonly config: ComplianceReportGeneratorConfig) {
    this.piiTags = config.piiTags ?? ['pii', 'phi', 'personal'];
    this.bhStart = config.businessHoursStart ?? 9;
    this.bhEnd = config.businessHoursEnd ?? 18;
  }

  async generate(request: ReportRequest): Promise<ComplianceReport> {
    const allEntries = await this.config.store.queryEntries(request.from, request.to);

    // Filter by agent IDs if specified
    const entries = request.agentIds?.length
      ? allEntries.filter((e) => request.agentIds!.includes(e.userId))
      : allEntries;

    const agentAccessSummary = this.buildAgentAccessSummary(entries);
    const piiResourceAccess = this.findPiiAccess(entries);
    const offHoursAccess = this.findOffHoursAccess(entries);
    const credentialRotationHistory = this.findRotationEvents(entries);
    const anomalyEvents = this.findAnomalyEvents(entries);

    const report: ComplianceReport = {
      type: request.type,
      generatedAt: new Date().toISOString(),
      periodFrom: request.from,
      periodTo: request.to,
      agentAccessSummary,
      piiResourceAccess,
      offHoursAccess,
      credentialRotationHistory,
      anomalyEvents,
      totalEntries: entries.length,
      summary: this.buildSummary(request.type, entries.length, piiResourceAccess.length, offHoursAccess.length, anomalyEvents.length),
    };

    if (request.format === 'markdown') {
      return { ...report, summary: this.buildMarkdownReport(report) };
    }

    return report;
  }

  private buildAgentAccessSummary(entries: AuditLogEntry[]): AgentAccessSummary[] {
    const map = new Map<string, AgentAccessSummary>();
    for (const e of entries) {
      if (e.action.startsWith('credential.')) continue; // system events
      let s = map.get(e.userId);
      if (!s) {
        s = { userId: e.userId, credentialIds: [], resourceIds: [], actionCounts: {}, resolutionCount: 0, firstSeen: e.timestamp, lastSeen: e.timestamp };
        map.set(e.userId, s);
      }
      if (!s.credentialIds.includes(e.credentialId)) s.credentialIds.push(e.credentialId);
      if (!s.resourceIds.includes(e.resourceId)) s.resourceIds.push(e.resourceId);
      s.actionCounts[e.action] = (s.actionCounts[e.action] ?? 0) + 1;
      s.resolutionCount += 1;
      if (e.timestamp < s.firstSeen) s.firstSeen = e.timestamp;
      if (e.timestamp > s.lastSeen) s.lastSeen = e.timestamp;
    }
    return Array.from(map.values()).sort((a, b) => b.resolutionCount - a.resolutionCount);
  }

  private findPiiAccess(entries: AuditLogEntry[]): AuditLogEntry[] {
    return entries.filter((e) =>
      this.piiTags.some((tag) => e.resourceId.toLowerCase().includes(tag))
    );
  }

  private findOffHoursAccess(entries: AuditLogEntry[]): OffHoursEntry[] {
    return entries
      .filter((e) => !e.action.startsWith('credential.') && isOffHours(e.timestamp, this.bhStart, this.bhEnd))
      .map((e) => ({ timestamp: e.timestamp, userId: e.userId, action: e.action, resourceId: e.resourceId, credentialId: e.credentialId }));
  }

  private findRotationEvents(entries: AuditLogEntry[]): CredentialRotationEntry[] {
    return entries
      .filter((e) => e.action === 'credential.rotated')
      .map((e) => ({ credentialId: e.credentialId, rotatedAt: e.timestamp, triggeredBy: e.userId }));
  }

  private findAnomalyEvents(entries: AuditLogEntry[]): AnomalyEventEntry[] {
    return entries
      .filter((e) => e.action === 'credential.anomaly')
      .map((e) => ({
        timestamp: e.timestamp,
        userId: e.userId,
        credentialId: e.credentialId,
        signal: (e as unknown as Record<string, string>).signal ?? 'unknown',
        severity: (e as unknown as Record<string, string>).severity ?? 'unknown',
      }));
  }

  private buildSummary(type: ReportType, total: number, pii: number, offHours: number, anomalies: number): string {
    return `${type.toUpperCase()} report: ${total} total resolutions, ${pii} PII resource accesses, ${offHours} off-hours accesses, ${anomalies} anomaly events`;
  }

  private buildMarkdownReport(report: ComplianceReport): string {
    const lines: string[] = [
      `# Agent Identity — ${report.type.toUpperCase()} Compliance Report`,
      `**Period:** ${report.periodFrom} – ${report.periodTo}`,
      `**Generated:** ${report.generatedAt}`,
      `**Total resolutions:** ${report.totalEntries}`,
      '',
      '## Agent Access Summary',
      '| Agent | Resolutions | Credentials | Resources | First Seen | Last Seen |',
      '|-------|-------------|-------------|-----------|------------|-----------|',
      ...report.agentAccessSummary.map((a) =>
        `| ${a.userId} | ${a.resolutionCount} | ${a.credentialIds.length} | ${a.resourceIds.length} | ${a.firstSeen.slice(0,10)} | ${a.lastSeen.slice(0,10)} |`
      ),
      '',
      `## PII Resource Access (${report.piiResourceAccess.length} events)`,
      report.piiResourceAccess.length === 0 ? '_None_' : report.piiResourceAccess.map((e) => `- ${e.timestamp} | ${e.userId} | ${e.action} | ${e.resourceId}`).join('\n'),
      '',
      `## Off-Hours Access (${report.offHoursAccess.length} events)`,
      report.offHoursAccess.length === 0 ? '_None_' : report.offHoursAccess.map((e) => `- ${e.timestamp} | ${e.userId} | ${e.action} | ${e.resourceId}`).join('\n'),
      '',
      `## Credential Rotation History (${report.credentialRotationHistory.length} rotations)`,
      report.credentialRotationHistory.length === 0 ? '_None_' : report.credentialRotationHistory.map((r) => `- ${r.rotatedAt} | ${r.credentialId} | triggered by ${r.triggeredBy}`).join('\n'),
      '',
      `## Anomaly Events (${report.anomalyEvents.length} events)`,
      report.anomalyEvents.length === 0 ? '_None_' : report.anomalyEvents.map((a) => `- ${a.timestamp} | ${a.userId} | ${a.credentialId} | ${a.signal} (${a.severity})`).join('\n'),
    ];
    return lines.join('\n');
  }
}
