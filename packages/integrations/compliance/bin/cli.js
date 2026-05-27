#!/usr/bin/env node
/**
 * agent-identity CLI
 *
 * Commands:
 *
 *   audit verify --file <path> [--quiet]
 *     Verify the SHA-256 chain of a JSONL audit log file.
 *     Exit 0 if intact, exit 1 if broken or empty.
 *
 *   report <type> --file <path> [--from <ISO>] [--to <ISO>] [--format json|markdown]
 *     Generate a compliance report from a JSONL audit log file.
 *     <type> must be one of: soc2 | gdpr | hipaa | custom
 *     Output is written to stdout.
 *
 * Examples:
 *
 *   agent-identity audit verify --file ./audit.jsonl
 *   agent-identity report soc2 --file ./audit.jsonl --format markdown
 *   agent-identity report gdpr --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Argument parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { args, positional };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function die(msg) {
  process.stderr.write(`\nError: ${msg}\n\n`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  process.stdout.write(`
agent-identity — Datacules LLC

Usage:
  agent-identity audit verify --file <path> [--quiet]
  agent-identity report <type> --file <path> [--from <ISO>] [--to <ISO>] [--format json|markdown]

Commands:
  audit verify    Verify the SHA-256 hash chain of a JSONL audit log file.
                  Exits 0 if intact, 1 if broken or empty.

  report <type>   Generate a compliance report from a JSONL audit log.
                  type: soc2 | gdpr | hipaa | custom

Options:
  --file <path>   Path to the JSONL audit log file (required)
  --from <ISO>    Report period start (ISO 8601, default: beginning of log)
  --to <ISO>      Report period end   (ISO 8601, default: end of log)
  --format        Output format for report: json (default) | markdown
  --quiet         Suppress progress output (audit verify only)

Examples:
  agent-identity audit verify --file ./audit.jsonl
  agent-identity report soc2 --file ./audit.jsonl --format markdown
  agent-identity report gdpr --file ./audit.jsonl --from 2026-01-01 --to 2026-06-30
`);
}

function readJsonlFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    die(`File not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

// ─── SHA-256 chain verification (inline — mirrors ChainVerifier from index.ts) ──
// We inline a plain-JS version so the CLI works without requiring the TS build.

const { createHash } = require('node:crypto');

function computeEntryHash(entry, prevHash) {
  const { hash: _h, prevHash: _p, ...coreFields } = entry;
  void _h; void _p;
  const sortedKeys = Object.keys(coreFields).sort();
  const payload = {};
  for (const k of sortedKeys) payload[k] = coreFields[k];
  return createHash('sha256')
    .update(JSON.stringify(payload) + prevHash)
    .digest('hex');
}

function verifyJsonl(jsonl) {
  const entries = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      return {
        intact: false,
        entryCount: entries.length,
        rootHash: entries[entries.length - 1]?.hash ?? null,
        brokenAt: entries.length,
        brokenReason: `Line ${i + 1}: failed to parse as JSON — log file may be corrupted`,
      };
    }
  }

  if (entries.length === 0) {
    return { intact: false, entryCount: 0, rootHash: null, brokenAt: null, brokenReason: 'Log is empty — nothing to verify' };
  }

  let prevHash = '';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.prevHash !== prevHash) {
      return {
        intact: false,
        entryCount: entries.length,
        rootHash: entries[i - 1]?.hash ?? null,
        brokenAt: i,
        brokenReason: `Entry ${i}: prevHash mismatch — expected ${prevHash.slice(0, 16)}… got ${String(entry.prevHash).slice(0, 16)}…`,
      };
    }
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

  return { intact: true, entryCount: entries.length, rootHash: prevHash, brokenAt: null, brokenReason: null };
}

// ─── Compliance report (inline — mirrors ComplianceReportGenerator) ─────────────

function isOffHours(timestamp, startHour = 9, endHour = 18) {
  const d = new Date(timestamp);
  const hour = d.getUTCHours();
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  return hour < startHour || hour >= endHour;
}

function generateReport(type, entries, format) {
  const agentMap = new Map();
  const piiAccess = [];
  const offHours = [];
  const rotations = [];
  const anomalies = [];
  const piiTags = ['pii', 'phi', 'personal'];

  for (const e of entries) {
    if (!e.action.startsWith('credential.')) {
      let s = agentMap.get(e.userId);
      if (!s) {
        s = { userId: e.userId, credentialIds: [], resourceIds: [], actionCounts: {}, resolutionCount: 0, firstSeen: e.timestamp, lastSeen: e.timestamp };
        agentMap.set(e.userId, s);
      }
      if (!s.credentialIds.includes(e.credentialId)) s.credentialIds.push(e.credentialId);
      if (!s.resourceIds.includes(e.resourceId)) s.resourceIds.push(e.resourceId);
      s.actionCounts[e.action] = (s.actionCounts[e.action] ?? 0) + 1;
      s.resolutionCount += 1;
      if (e.timestamp < s.firstSeen) s.firstSeen = e.timestamp;
      if (e.timestamp > s.lastSeen) s.lastSeen = e.timestamp;

      if (piiTags.some(tag => e.resourceId.toLowerCase().includes(tag))) piiAccess.push(e);
      if (isOffHours(e.timestamp)) offHours.push({ timestamp: e.timestamp, userId: e.userId, action: e.action, resourceId: e.resourceId, credentialId: e.credentialId });
    }
    if (e.action === 'credential.rotated') rotations.push({ credentialId: e.credentialId, rotatedAt: e.timestamp, triggeredBy: e.userId });
    if (e.action === 'credential.anomaly') anomalies.push({ timestamp: e.timestamp, userId: e.userId, credentialId: e.credentialId, signal: e.signal ?? 'unknown', severity: e.severity ?? 'unknown' });
  }

  const summary = Array.from(agentMap.values()).sort((a, b) => b.resolutionCount - a.resolutionCount);

  const report = {
    type,
    generatedAt: new Date().toISOString(),
    periodFrom: entries[0]?.timestamp ?? 'n/a',
    periodTo: entries[entries.length - 1]?.timestamp ?? 'n/a',
    agentAccessSummary: summary,
    piiResourceAccess: piiAccess,
    offHoursAccess: offHours,
    credentialRotationHistory: rotations,
    anomalyEvents: anomalies,
    totalEntries: entries.length,
    summary: `${type.toUpperCase()} report: ${entries.length} total resolutions, ${piiAccess.length} PII accesses, ${offHours.length} off-hours accesses, ${anomalies.length} anomaly events`,
  };

  if (format === 'markdown') {
    const lines = [
      `# Agent Identity — ${type.toUpperCase()} Compliance Report`,
      `**Period:** ${report.periodFrom} – ${report.periodTo}`,
      `**Generated:** ${report.generatedAt}`,
      `**Total resolutions:** ${report.totalEntries}`,
      '',
      '## Agent Access Summary',
      '| Agent | Resolutions | Credentials | Resources | First Seen | Last Seen |',
      '|-------|-------------|-------------|-----------|------------|-----------|',
      ...summary.map(a => `| ${a.userId} | ${a.resolutionCount} | ${a.credentialIds.length} | ${a.resourceIds.length} | ${a.firstSeen.slice(0,10)} | ${a.lastSeen.slice(0,10)} |`),
      '',
      `## PII Resource Access (${piiAccess.length} events)`,
      piiAccess.length === 0 ? '_None_' : piiAccess.map(e => `- ${e.timestamp} | ${e.userId} | ${e.action} | ${e.resourceId}`).join('\n'),
      '',
      `## Off-Hours Access (${offHours.length} events)`,
      offHours.length === 0 ? '_None_' : offHours.map(e => `- ${e.timestamp} | ${e.userId} | ${e.action} | ${e.resourceId}`).join('\n'),
      '',
      `## Credential Rotation History (${rotations.length} rotations)`,
      rotations.length === 0 ? '_None_' : rotations.map(r => `- ${r.rotatedAt} | ${r.credentialId} | triggered by ${r.triggeredBy}`).join('\n'),
      '',
      `## Anomaly Events (${anomalies.length} events)`,
      anomalies.length === 0 ? '_None_' : anomalies.map(a => `- ${a.timestamp} | ${a.userId} | ${a.credentialId} | ${a.signal} (${a.severity})`).join('\n'),
    ];
    return lines.join('\n');
  }

  return JSON.stringify(report, null, 2);
}

// ─── Main ────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const { args, positional } = parseArgs(argv);

if (positional.length === 0 || positional[0] === 'help' || args.help || args.h) {
  printHelp();
  process.exit(0);
}

const command = positional[0];
const subCommand = positional[1];

// ── agent-identity audit verify ──────────────────────────────────────────────────
if (command === 'audit' && subCommand === 'verify') {
  if (!args.file) die('--file <path> is required');

  const content = readJsonlFile(args.file);
  const result = verifyJsonl(content);

  if (!args.quiet) {
    process.stdout.write(`\nAudit log verification — ${path.resolve(args.file)}\n`);
    process.stdout.write(`Entries verified : ${result.entryCount}\n`);
    process.stdout.write(`Chain status     : ${result.intact ? '\u2705  INTACT' : '\u274C  BROKEN'}\n`);
    if (result.rootHash) {
      process.stdout.write(`Chain root hash  : ${result.rootHash}\n`);
    }
    if (!result.intact) {
      process.stdout.write(`Broken at entry  : ${result.brokenAt ?? 'n/a'}\n`);
      process.stdout.write(`Reason           : ${result.brokenReason}\n`);
    }
    process.stdout.write('\n');
  }

  process.exit(result.intact ? 0 : 1);
}

// ── agent-identity report <type> ────────────────────────────────────────────────
if (command === 'report') {
  const reportType = subCommand;
  if (!reportType || !['soc2', 'gdpr', 'hipaa', 'custom'].includes(reportType)) {
    die(`report type must be one of: soc2 | gdpr | hipaa | custom (got: ${reportType ?? 'none'})`);
  }
  if (!args.file) die('--file <path> is required');

  const content = readJsonlFile(args.file);
  const lines = content.split('\n').filter(l => l.trim());
  let entries;
  try {
    entries = lines.map(l => JSON.parse(l));
  } catch (err) {
    die(`Failed to parse JSONL file: ${err.message}`);
  }

  // Filter by date range if provided
  let filtered = entries;
  if (args.from) {
    const start = new Date(args.from).getTime();
    filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= start);
  }
  if (args.to) {
    const end = new Date(args.to).getTime();
    filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= end);
  }

  const format = args.format === 'markdown' ? 'markdown' : 'json';
  const output = generateReport(reportType, filtered, format);
  process.stdout.write(output + '\n');
  process.exit(0);
}

// ── Unknown command ──────────────────────────────────────────────────────────────
die(`Unknown command: ${command} ${subCommand ?? ''}`.trim());
