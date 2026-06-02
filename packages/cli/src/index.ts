/**
 * @datacules/agent-identity-cli
 *
 * CLI for @datacules/agent-identity.
 *
 * Commands:
 *   audit verify   — Verify SHA-256 hash chain integrity of a JSONL audit log
 *   report soc2    — Generate a SOC 2 CC6 compliance report
 *   report gdpr    — Generate a GDPR Article 30 compliance report
 *   report hipaa   — Generate a HIPAA §164.312 compliance report
 *   health         — Check if the agent-identity server is responding
 *   resolve        — Test credential resolution against the running server
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  ChainVerifier,
  ComplianceReportGenerator,
  MemoryReportStore,
} from '@datacules/agent-identity-compliance';
import type { ChainedAuditLogEntry, ReportType } from '@datacules/agent-identity-compliance';

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
agent-identity — @datacules/agent-identity CLI v0.1.0

Usage:
  agent-identity audit verify --file <path> [--from <date>] [--to <date>]
  agent-identity report <soc2|gdpr|hipaa> --file <path> [--from <date>] [--to <date>] [--format json|markdown] [--output <dir>]
  agent-identity health [--url <url>]
  agent-identity resolve --provider <provider> --user <userId> [--url <url>]

Commands:
  audit verify     Verify SHA-256 hash chain integrity of a JSONL audit log
  report soc2      Generate a SOC 2 CC6 compliance report from an audit log
  report gdpr      Generate a GDPR Article 30 compliance report
  report hipaa     Generate a HIPAA §164.312 compliance report
  health           Check if the agent-identity server is healthy
  resolve          Test credential resolution against the running server

Options:
  --file <path>    Path to a JSONL audit log file (one JSON object per line)
  --from <date>    Start of reporting period (ISO 8601, e.g. 2026-01-01)
  --to <date>      End of reporting period (ISO 8601, e.g. 2026-03-31)
  --format         Output format: json (default) or markdown
  --output <dir>   Directory to write report to (default: stdout)
  --url <url>      Base URL of the agent-identity server (default: http://localhost:3000)
  --provider       AI provider: openai|anthropic|gemini|mistral|local
  --user <userId>  User ID for resolve testing
  --help, -h       Show this help

Examples:
  agent-identity audit verify --file ./audit.jsonl
  agent-identity audit verify --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31
  agent-identity report soc2 --file ./audit.jsonl --from 2026-01-01 --to 2026-03-31
  agent-identity report gdpr --file ./audit.jsonl --format markdown
  agent-identity report hipaa --file ./audit.jsonl --output ./reports/
  agent-identity health
  agent-identity health --url http://localhost:3001
  agent-identity resolve --provider openai --user user-123
`.trim();

// ─── Arg parser (zero deps) ──────────────────────────────────────────────────

interface ParsedArgs {
  command: string[];
  file?: string;
  from?: string;
  to?: string;
  format?: string;
  output?: string;
  url?: string;
  provider?: string;
  user?: string;
  help: boolean;
}

export function parseArguments(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { command: [], help: false };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h')  { result.help = true;             i++; continue; }
    if (arg === '--file')                  { result.file     = argv[++i];    i++; continue; }
    if (arg === '--from')                  { result.from     = argv[++i];    i++; continue; }
    if (arg === '--to')                    { result.to       = argv[++i];    i++; continue; }
    if (arg === '--format')                { result.format   = argv[++i];    i++; continue; }
    if (arg === '--output')                { result.output   = argv[++i];    i++; continue; }
    if (arg === '--url')                   { result.url      = argv[++i];    i++; continue; }
    if (arg === '--provider')              { result.provider = argv[++i];    i++; continue; }
    if (arg === '--user')                  { result.user     = argv[++i];    i++; continue; }
    if (!arg.startsWith('-'))              { result.command.push(arg); }
    i++;
  }
  return result;
}

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface CliOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ─── audit verify ─────────────────────────────────────────────────────────────

export interface AuditVerifyOptions {
  file: string;
  from?: string;
  to?: string;
  /** Injectable for testing — defaults to fs.readFileSync */
  readFile?: (path: string) => string;
}

export async function runAuditVerify(opts: AuditVerifyOptions): Promise<CliOutput> {
  const read = opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'));

  let content: string;
  try {
    content = read(opts.file);
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: cannot read file '${opts.file}': ${(err as Error).message}`,
    };
  }

  // Optional date-range filter: keep only entries whose timestamp falls in [from, to]
  let jsonl = content;
  if (opts.from ?? opts.to) {
    const start = opts.from ? new Date(opts.from).getTime() : 0;
    const end   = opts.to   ? new Date(opts.to + 'T23:59:59.999Z').getTime() : Infinity;
    const lines = content.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      try {
        const entry = JSON.parse(trimmed) as { timestamp?: string };
        const t = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        return t >= start && t <= end;
      } catch {
        return true; // keep unparseable lines — ChainVerifier will report them
      }
    });
    jsonl = lines.join('\n');
  }

  const result = ChainVerifier.verifyJsonl(jsonl);

  if (result.intact) {
    const out = [
      '✓ Audit chain intact',
      `  Entries verified : ${result.entryCount}`,
      `  Root hash        : ${(result.rootHash ?? '').slice(0, 16)}…`,
    ].join('\n');
    return { exitCode: 0, stdout: out, stderr: '' };
  }

  const out = [
    '✗ Audit chain BROKEN',
    `  Entries checked  : ${result.entryCount}`,
    `  Broken at index  : ${result.brokenAt ?? 'N/A'}`,
    `  Reason           : ${result.brokenReason ?? 'unknown'}`,
  ].join('\n');
  return { exitCode: 1, stdout: out, stderr: '' };
}

// ─── report ───────────────────────────────────────────────────────────────────

export interface ReportOptions {
  type: ReportType;
  file: string;
  from?: string;
  to?: string;
  format?: string;
  output?: string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

export async function runReport(opts: ReportOptions): Promise<CliOutput> {
  const read = opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const write = opts.writeFile ?? ((p: string, c: string) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c, 'utf8');
  });

  let content: string;
  try {
    content = read(opts.file);
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Error: cannot read file '${opts.file}': ${(err as Error).message}`,
    };
  }

  // Parse JSONL — skip blank lines and non-JSON lines
  const entries: ChainedAuditLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed) as ChainedAuditLogEntry); } catch { /* skip */ }
  }

  const now = new Date();
  const fromDate = opts.from ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01T00:00:00Z`;
  const toDate   = opts.to   ? `${opts.to}T23:59:59.999Z` : now.toISOString();

  const store = new MemoryReportStore(entries);
  const generator = new ComplianceReportGenerator({ store });
  const report = await generator.generate({
    type: opts.type,
    from: fromDate,
    to: toDate,
    format: opts.format === 'markdown' ? 'markdown' : 'json',
  });

  // For markdown format, the generate() method sets report.summary to the
  // markdown string. For JSON we serialise the full report object.
  const formatted =
    opts.format === 'markdown'
      ? report.summary
      : JSON.stringify(report, null, 2);

  if (opts.output) {
    const ext = opts.format === 'markdown' ? '.md' : '.json';
    const from8 = fromDate.slice(0, 10);
    const to8   = toDate.slice(0, 10);
    const filename = `${opts.type}-report-${from8}-to-${to8}${ext}`;
    const outPath = join(opts.output, filename);
    write(outPath, formatted);
    return { exitCode: 0, stdout: `Report written to ${outPath}`, stderr: '' };
  }

  return { exitCode: 0, stdout: formatted, stderr: '' };
}

// ─── health ───────────────────────────────────────────────────────────────────

export interface HealthOptions {
  url?: string;
  fetch?: typeof globalThis.fetch;
}

export async function runHealth(opts: HealthOptions): Promise<CliOutput> {
  const base    = opts.url ?? 'http://localhost:3000';
  const fetchFn = opts.fetch ?? globalThis.fetch;
  try {
    const res = await fetchFn(`${base}/api/health`);
    if (res.ok) {
      return { exitCode: 0, stdout: `✓ Server at ${base} is healthy (HTTP ${res.status})`, stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: `✗ Server at ${base} returned HTTP ${res.status}` };
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: `✗ Cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

// ─── resolve ──────────────────────────────────────────────────────────────────

export interface ResolveOptions {
  provider: string;
  user: string;
  url?: string;
  fetch?: typeof globalThis.fetch;
}

export async function runResolve(opts: ResolveOptions): Promise<CliOutput> {
  const base    = opts.url ?? 'http://localhost:3000';
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const body = JSON.stringify({
    userId: opts.user,
    provider: opts.provider,
    agentId: 'cli-test',
    action: 'read',
    requestedAt: new Date().toISOString(),
  });
  try {
    const res  = await fetchFn(`${base}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json() as Record<string, unknown>;
    if (res.ok) {
      return { exitCode: 0, stdout: JSON.stringify(data, null, 2), stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: `✗ Resolve failed (HTTP ${res.status}): ${JSON.stringify(data)}` };
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: `✗ Cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
  const args = parseArguments(argv);

  if (args.help || args.command.length === 0) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const [cmd, sub] = args.command;
  let result: CliOutput;

  if (cmd === 'audit' && sub === 'verify') {
    if (!args.file) {
      process.stderr.write('Error: --file <path> is required for \'audit verify\'\n');
      process.exit(1);
    }
    result = await runAuditVerify({ file: args.file, from: args.from, to: args.to });

  } else if (cmd === 'report' && (sub === 'soc2' || sub === 'gdpr' || sub === 'hipaa')) {
    if (!args.file) {
      process.stderr.write('Error: --file <path> is required for \'report\'\n');
      process.exit(1);
    }
    result = await runReport({
      type: sub as ReportType,
      file: args.file,
      from: args.from,
      to: args.to,
      format: args.format,
      output: args.output,
    });

  } else if (cmd === 'health') {
    result = await runHealth({ url: args.url });

  } else if (cmd === 'resolve') {
    if (!args.provider || !args.user) {
      process.stderr.write('Error: --provider and --user are required for \'resolve\'\n');
      process.exit(1);
    }
    result = await runResolve({ provider: args.provider, user: args.user, url: args.url });

  } else {
    process.stderr.write(`Unknown command: ${args.command.join(' ')}\n${HELP}\n`);
    process.exit(1);
    return;
  }

  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}
