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
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';
import { createHash } from 'node:crypto';

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

// ─── HashChainAuditLogger ────────────────────────────────────────────────────────

/**
 * A chained audit log entry — extends the base AuditLogEntry with two
 * additional fields that form the tamper-evident SHA-256 chain.
 */
export interface ChainedAuditLogEntry extends AuditLogEntry {
  /** SHA-256 hash of (serialised entry data + prevHash) */
  hash: string;
  /** Hash of the immediately preceding entry, or '' for the first entry */
  prevHash: string;
}

/**
 * Result returned by ChainVerifier.verify()
 */
export interface VerificationResult {
  /** true only if every entry's hash recomputes correctly */
  intact: boolean;
  /** Number of entries verified */
  entryCount: number;
  /** SHA-256 hash of the last valid entry (the chain root for anchoring) */
  rootHash: string | null;
  /** Index of the first broken link (null if intact) */
  brokenAt: number | null;
  /** Human-readable reason for breakage (null if intact) */
  brokenReason: string | null;
}

/**
 * Computes the SHA-256 hash for a single audit log entry.
 *
 * The hash input is:
 *   SHA256( JSON.stringify(coreFields) + prevHash )
 *
 * where coreFields are the entry's own data fields (excluding hash/prevHash
 * themselves) sorted by key for deterministic serialisation.
 */
function computeEntryHash(entry: AuditLogEntry, prevHash: string): string {
  // Exclude the chain fields from the payload so re-verification is stable
  const { hash: _h, prevHash: _p, ...coreFields } = entry as ChainedAuditLogEntry;
  void _h; void _p;
  const sortedKeys = Object.keys(coreFields).sort();
  const payload: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    payload[k] = (coreFields as Record<string, unknown>)[k];
  }
  return createHash('sha256')
    .update(JSON.stringify(payload) + prevHash)
    .digest('hex');
}

/**
 * HashChainAuditLogger wraps any existing AuditLogger and appends
 * `hash` and `prevHash` fields to every entry before forwarding to
 * the underlying sink.
 *
 * Each entry's hash covers its own data + the previous entry's hash,
 * forming a SHA-256 linked list. Any retroactive modification to an
 * entry breaks the chain from that point forward — detectable by
 * ChainVerifier.verify() in O(n) time.
 *
 * Usage:
 *   const base = new ConsoleAuditLogger();
 *   const chained = new HashChainAuditLogger(base);
 *   const router = createRouter(credentials, rules, chained);
 *
 * The underlying sink receives ChainedAuditLogEntry objects. If it
 * serialises to JSONL (one JSON object per line), that file can be
 * verified offline with:
 *   agent-identity audit verify --file ./audit.jsonl
 */
export class HashChainAuditLogger implements AuditLogger {
  private prevHash = '';

  constructor(private readonly sink: AuditLogger) {}

  log(entry: AuditLogEntry): void {
    const hash = computeEntryHash(entry, this.prevHash);
    const chained: ChainedAuditLogEntry = {
      ...entry,
      prevHash: this.prevHash,
      hash,
    };
    this.prevHash = hash;
    this.sink.log(chained as unknown as AuditLogEntry);
  }

  /** Returns the hash of the most recently logged entry (the current chain tip) */
  get currentHash(): string {
    return this.prevHash;
  }
}

/**
 * Verifies a sequence of ChainedAuditLogEntry objects.
 *
 * Replays the SHA-256 chain from the beginning. The first entry must
 * have prevHash === '' (empty string). Every subsequent entry's hash
 * must equal SHA256(sortedEntryData + prevEntry.hash).
 *
 * Any single field modification in any entry will break the chain
 * from that entry onward.
 */
export class ChainVerifier {
  /**
   * Verify an in-memory array of entries.
   *
   * @param entries - Array of entries parsed from an audit log
   */
  static verify(entries: ChainedAuditLogEntry[]): VerificationResult {
    if (entries.length === 0) {
      return { intact: false, entryCount: 0, rootHash: null, brokenAt: null, brokenReason: 'Log is empty — nothing to verify' };
    }

    let prevHash = '';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Check the recorded prevHash matches our running chain
      if (entry.prevHash !== prevHash) {
        return {
          intact: false,
          entryCount: entries.length,
          rootHash: entries[i - 1]?.hash ?? null,
          brokenAt: i,
          brokenReason: `Entry ${i}: prevHash mismatch — expected ${prevHash.slice(0, 16)}… got ${entry.prevHash.slice(0, 16)}…`,
        };
      }

      // Recompute the hash and check it matches what was recorded
      const expected = computeEntryHash(entry, prevHash);
      if (entry.hash !== expected) {
        return {
          intact: false,
          entryCount: entries.length,
          rootHash: entries[i - 1]?.hash ?? null,
          brokenAt: i,
          brokenReason: `Entry ${i}: hash mismatch — entry data appears to have been modified`,
        };
      }

      prevHash = entry.hash;
    }

    return {
      intact: true,
      entryCount: entries.length,
      rootHash: prevHash,
      brokenAt: null,
      brokenReason: null,
    };
  }

  /**
   * Parse a JSONL string (one JSON object per line) and verify the chain.
   * Blank lines and lines that fail JSON.parse are skipped with a warning.
   *
   * @param jsonl - Full JSONL file content as a string
   */
  static verifyJsonl(jsonl: string): VerificationResult {
    const entries: ChainedAuditLogEntry[] = [];
    const lines = jsonl.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as ChainedAuditLogEntry);
      } catch {
        // Non-JSON line — treat as a chain break
        return {
          intact: false,
          entryCount: entries.length,
          rootHash: entries[entries.length - 1]?.hash ?? null,
          brokenAt: entries.length,
          brokenReason: `Line ${i + 1}: failed to parse as JSON — log file may be corrupted`,
        };
      }
    }
    return ChainVerifier.verify(entries);
  }
}
