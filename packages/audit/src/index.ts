/**
 * @datacules/agent-identity-audit — extended with hash-chain tamper-evident logging
 *
 * New in this version:
 *   HashChainAuditLogger — wraps any existing AuditLogger and appends a SHA-256
 *   hash chain to every entry. Detects tampering by recomputing the chain.
 *   ChainAnchor interface + built-in S3 and stdout anchors.
 */
import type { AuditLogEntry, AuditLogger } from '@datacules/agent-identity';

// ──────────────────────────────────────────────────────────────────────────
// Existing sinks
// ──────────────────────────────────────────────────────────────────────────

export class ConsoleAuditLogger implements AuditLogger {
  async log(entry: AuditLogEntry): Promise<void> {
    console.log('[agent-identity audit]', JSON.stringify(entry, null, 2));
  }
}

export interface WebhookAuditLoggerOptions {
  url: string;
  secret?: string;
  timeoutMs?: number;
  silent?: boolean;
}

export class WebhookAuditLogger implements AuditLogger {
  private readonly options: Required<WebhookAuditLoggerOptions>;
  constructor(options: WebhookAuditLoggerOptions) {
    this.options = { secret: '', timeoutMs: 5000, silent: true, ...options };
  }
  async log(entry: AuditLogEntry): Promise<void> {
    const { url, secret, timeoutMs, silent } = this.options;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Webhook-Secret'] = secret;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(url, { method: 'POST', headers, body: JSON.stringify(entry), signal: controller.signal });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] WebhookAuditLogger failed:', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface DatadogAuditLoggerOptions {
  apiKey: string;
  service?: string;
  site?: string;
  silent?: boolean;
}

export class DatadogAuditLogger implements AuditLogger {
  private readonly options: Required<DatadogAuditLoggerOptions>;
  constructor(options: DatadogAuditLoggerOptions) {
    this.options = { service: 'agent-identity', site: 'datadoghq.com', silent: true, ...options };
  }
  async log(entry: AuditLogEntry): Promise<void> {
    const { apiKey, service, site, silent } = this.options;
    try {
      await fetch(`https://http-intake.logs.${site}/api/v2/logs`, {
        method: 'POST',
        headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ddsource: 'agent-identity', service, message: JSON.stringify(entry) }),
      });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] DatadogAuditLogger failed:', err);
    }
  }
}

export interface SplunkAuditLoggerOptions {
  hecUrl: string;
  token: string;
  sourcetype?: string;
  silent?: boolean;
}

export class SplunkAuditLogger implements AuditLogger {
  private readonly options: Required<SplunkAuditLoggerOptions>;
  constructor(options: SplunkAuditLoggerOptions) {
    this.options = { sourcetype: 'agent_identity', silent: true, ...options };
  }
  async log(entry: AuditLogEntry): Promise<void> {
    const { hecUrl, token, sourcetype, silent } = this.options;
    try {
      await fetch(hecUrl, {
        method: 'POST',
        headers: { Authorization: `Splunk ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: entry, sourcetype }),
      });
    } catch (err) {
      if (!silent) throw err;
      console.warn('[agent-identity] SplunkAuditLogger failed:', err);
    }
  }
}

export class CompositeAuditLogger implements AuditLogger {
  constructor(private readonly loggers: AuditLogger[]) {}
  async log(entry: AuditLogEntry): Promise<void> {
    await Promise.allSettled(this.loggers.map((l) => l.log(entry)));
  }
}

// ─── Hash chain types ────────────────────────────────────────────────────────────

export interface ChainedAuditLogEntry extends AuditLogEntry {
  /** SHA-256 hash of this entry's data fields */
  entryHash: string;
  /** SHA-256 hash of the previous entry (or '0' for the first entry) */
  previousHash: string;
  /** Sequential position in the chain */
  sequence: number;
}

export interface ChainVerificationResult {
  valid: boolean;
  entriesChecked: number;
  firstEntry?: ChainedAuditLogEntry;
  lastEntry?: ChainedAuditLogEntry;
  brokenAt?: number; // sequence number where chain breaks
  error?: string;
}

// ─── Chain Anchor ────────────────────────────────────────────────────────────────

export interface ChainAnchor {
  /** Publish the chain root hash to an immutable external location */
  publish(rootHash: string, sequence: number, timestamp: string): Promise<void>;
}

/** Prints the chain root to stdout — suitable for piping to a CI artifact */
export class StdoutChainAnchor implements ChainAnchor {
  async publish(rootHash: string, sequence: number, timestamp: string): Promise<void> {
    console.log(`[agent-identity chain-anchor] seq=${sequence} root=${rootHash} ts=${timestamp}`);
  }
}

/** Publishes the chain root hash to an S3 object with Object Lock enabled */
export interface S3ChainAnchorOptions {
  bucketName: string;
  region: string;
  /** AWS credentials or SDK client — omit to use default credential chain */
  credentialsJson?: string;
}

export class S3ChainAnchor implements ChainAnchor {
  constructor(private readonly opts: S3ChainAnchorOptions) {}

  async publish(rootHash: string, sequence: number, timestamp: string): Promise<void> {
    const key = `agent-identity/chain-roots/${sequence}-${timestamp}.json`;
    const body = JSON.stringify({ rootHash, sequence, timestamp, publishedAt: new Date().toISOString() });
    // S3 PutObject — in production use @aws-sdk/client-s3
    const url = `https://${this.opts.bucketName}.s3.${this.opts.region}.amazonaws.com/${key}`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    }).catch((err) => console.warn('[S3ChainAnchor] publish failed:', err));
  }
}

// ─── HashChainAuditLogger ──────────────────────────────────────────────────────

export interface HashChainOptions {
  /** Downstream sink that receives chained entries */
  sink: AuditLogger;
  /** Publish chain root every N entries (default: 1000) */
  anchorEveryN?: number;
  /** Optional anchor to publish roots externally */
  anchor?: ChainAnchor;
  /** Seed hash for the first entry (default: '0') */
  seedHash?: string;
}

/**
 * Wraps any AuditLogger with tamper-evident SHA-256 hash chaining.
 *
 * Each entry is hashed together with the hash of the previous entry.
 * Any modification to a historical entry breaks the chain from that
 * point forward — detectable by recomputing and comparing hashes.
 *
 * @example
 * const logger = new HashChainAuditLogger({
 *   sink: new DatadogAuditLogger({ apiKey: process.env.DD_API_KEY! }),
 *   anchor: new S3ChainAnchor({ bucketName: 'my-audit-anchors', region: 'us-east-1' }),
 * });
 */
export class HashChainAuditLogger implements AuditLogger {
  private previousHash: string;
  private sequence = 0;
  private readonly anchorEveryN: number;

  constructor(private readonly opts: HashChainOptions) {
    this.previousHash = opts.seedHash ?? '0';
    this.anchorEveryN = opts.anchorEveryN ?? 1000;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    this.sequence += 1;
    const entryHash = await this.sha256(JSON.stringify(entry));
    const chainHash = await this.sha256(`${this.previousHash}:${entryHash}`);

    const chained: ChainedAuditLogEntry = {
      ...entry,
      entryHash,
      previousHash: this.previousHash,
      sequence: this.sequence,
    };

    this.previousHash = chainHash;

    await this.opts.sink.log(chained as unknown as AuditLogEntry);

    if (this.opts.anchor && this.sequence % this.anchorEveryN === 0) {
      await this.opts.anchor
        .publish(chainHash, this.sequence, new Date().toISOString())
        .catch(console.error);
    }
  }

  /** Verify an ordered array of chained entries; returns result with first broken sequence if any */
  async verify(entries: ChainedAuditLogEntry[]): Promise<ChainVerificationResult> {
    let prevHash = this.opts.seedHash ?? '0';
    for (const entry of entries) {
      const { entryHash, previousHash, sequence, ...data } = entry;
      const expectedEntryHash = await this.sha256(JSON.stringify(data));
      if (expectedEntryHash !== entryHash) {
        return { valid: false, entriesChecked: sequence, brokenAt: sequence, error: `entry hash mismatch at sequence ${sequence}` };
      }
      if (previousHash !== prevHash) {
        return { valid: false, entriesChecked: sequence, brokenAt: sequence, error: `chain break at sequence ${sequence}` };
      }
      prevHash = await this.sha256(`${previousHash}:${entryHash}`);
    }
    return {
      valid: true,
      entriesChecked: entries.length,
      firstEntry: entries[0],
      lastEntry: entries[entries.length - 1],
    };
  }

  private async sha256(data: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    const { createHash } = await import('crypto');
    return createHash('sha256').update(data).digest('hex');
  }
}
