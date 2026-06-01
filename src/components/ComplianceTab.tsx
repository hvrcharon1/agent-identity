'use client';

import { useState } from 'react';

type ReportType = 'soc2' | 'gdpr' | 'hipaa';

interface ReportConfig {
  type: ReportType;
  label: string;
  standard: string;
  sections: string[];
  sampleSummary: Record<string, unknown>;
}

const REPORT_CONFIGS: ReportConfig[] = [
  {
    type: 'soc2',
    label: 'SOC 2',
    standard: 'SOC 2 CC6 — Logical and Physical Access Controls',
    sections: ['agentAccessSummary', 'credentialRotationHistory', 'approvalWorkflowLog', 'anomalyEvents'],
    sampleSummary: {
      reportType: 'soc2',
      period: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
      agentAccessSummary: [
        { agentId: 'orders-agent', totalResolutions: 14872, uniqueCredentials: 3, uniqueResources: 8 },
        { agentId: 'analytics-agent', totalResolutions: 4331, uniqueCredentials: 1, uniqueResources: 2 },
      ],
      credentialRotationHistory: [
        { credentialId: 'cred-openai-prod', rotatedAt: '2026-02-15T03:00:00Z', provisioner: 'vault-kv', rotatedBy: 'system' },
        { credentialId: 'cred-anthropic-api', rotatedAt: '2026-03-01T03:00:00Z', provisioner: 'aws-secrets', rotatedBy: 'system' },
      ],
      anomalyEvents: [],
    },
  },
  {
    type: 'gdpr',
    label: 'GDPR',
    standard: 'GDPR Article 30 — Records of Processing Activities',
    sections: ['agentAccessSummary', 'piiResourceAccess', 'offHoursAccess'],
    sampleSummary: {
      reportType: 'gdpr',
      period: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
      agentAccessSummary: [
        { agentId: 'orders-agent', totalResolutions: 14872, uniqueCredentials: 3, uniqueResources: 8 },
      ],
      piiResourceAccess: [
        { resourceId: 'crm-customer-db', tag: 'pii', accessCount: 9843, agents: ['orders-agent'], lastAccessed: '2026-03-31T22:14:00Z' },
      ],
      offHoursAccess: [
        { agentId: 'orders-agent', accessAt: '2026-03-14T02:33:00Z', action: 'read', resourceId: 'crm-customer-db', anomalyFlag: false },
      ],
    },
  },
  {
    type: 'hipaa',
    label: 'HIPAA',
    standard: 'HIPAA §164.312 — Access Controls',
    sections: ['agentAccessSummary', 'piiResourceAccess', 'approvalWorkflowLog', 'anomalyEvents'],
    sampleSummary: {
      reportType: 'hipaa',
      period: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
      agentAccessSummary: [
        { agentId: 'ehr-agent', totalResolutions: 28741, uniqueCredentials: 2, uniqueResources: 5 },
      ],
      piiResourceAccess: [
        { resourceId: 'patient-records-db', tag: 'phi', accessCount: 28741, agents: ['ehr-agent'], lastAccessed: '2026-03-31T23:59:00Z' },
      ],
      anomalyEvents: [
        { agentId: 'ehr-agent', severity: 'low', signal: 'off_hours_access', detectedAt: '2026-02-20T03:11:00Z', resolved: true },
      ],
    },
  },
];

const CHAIN_ENTRIES = [
  { seq: 1, action: 'credential.resolved', agent: 'orders-agent', hash: 'a3f9c21e…', prevHash: '0000000…' },
  { seq: 2, action: 'credential.rotated',  agent: 'system',       hash: 'b82de4f7…', prevHash: 'a3f9c21e…' },
  { seq: 3, action: 'approval.approved',   agent: 'oncall-lead',  hash: 'd91a73c2…', prevHash: 'b82de4f7…' },
  { seq: 4, action: 'credential.resolved', agent: 'ehr-agent',    hash: 'e04b58a1…', prevHash: 'd91a73c2…' },
];

export function ComplianceTab() {
  const [reportType, setReportType] = useState<ReportType>('soc2');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const config = REPORT_CONFIGS.find((r) => r.type === reportType)!;

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setReport(null);
    await new Promise((r) => setTimeout(r, 1200));
    setReport(JSON.stringify(config.sampleSummary, null, 2));
    setActiveSection(config.sections[0]);
    setGenerating(false);
  };

  const snippet = `import { ComplianceReportGenerator } from '@datacules/agent-identity-compliance';
import { HashChainAuditLogger } from '@datacules/agent-identity-compliance';
import { ConsoleAuditLogger } from '@datacules/agent-identity-audit';

// Wrap any audit logger with a tamper-evident hash chain
const chainLogger = new HashChainAuditLogger(new ConsoleAuditLogger());
const router = createRouterFromStore(store, rules, chainLogger);

// Generate a compliance report from the audit store
const generator = new ComplianceReportGenerator({ store: auditStore });

const report = await generator.generate({
  type:   'soc2',          // 'soc2' | 'gdpr' | 'hipaa' | 'custom'
  from:   '2026-01-01T00:00:00Z',
  to:     '2026-03-31T23:59:59Z',
  format: 'json',          // 'json' | 'markdown'
});
// report.agentAccessSummary, .piiResourceAccess, .credentialRotationHistory
// report.offHoursAccess, .approvalWorkflowLog, .anomalyEvents

// Verify hash-chain integrity for a date range
// $ agent-identity audit verify --from 2026-01-01 --to 2026-03-31`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Compliance Reports + Verifiable Audit Log</h2>
        <p className="text-sm text-gray-500">
          <code className="text-xs bg-gray-100 px-1 rounded">ComplianceReportGenerator</code> and{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">HashChainAuditLogger</code> from{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">@datacules/agent-identity-compliance</code>.
          Reports answer SOC 2, GDPR, and HIPAA audit questions directly from the log store.
          The hash chain makes every log entry tamper-evident — any modification breaks the chain
          from that entry forward, detectable in O(n) time.
        </p>
      </div>

      {/* Report type selector */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Report type</div>
        <div className="flex gap-2">
          {REPORT_CONFIGS.map((r) => (
            <button
              key={r.type}
              onClick={() => { setReportType(r.type); setReport(null); }}
              className={`px-3 py-1.5 rounded-md text-xs border font-medium transition-colors ${
                reportType === r.type
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">{config.standard}</p>
      </div>

      {/* Generate button */}
      <div>
        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : 'generator.generate({ type: \'' + reportType + '\' })'}
        </button>
      </div>

      {/* Report output */}
      {report && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Report output</div>
          <div className="flex gap-2 mb-2 flex-wrap">
            {config.sections.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  activeSection === s
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto max-h-60 leading-relaxed">
            <code>
              {activeSection
                ? JSON.stringify((config.sampleSummary as Record<string, unknown>)[activeSection], null, 2)
                : report}
            </code>
          </pre>
        </div>
      )}

      {/* Hash chain visualizer */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">HashChainAuditLogger — tamper-evident chain</div>
        <div className="space-y-1">
          {CHAIN_ENTRIES.map((entry, i) => (
            <div key={entry.seq} className="flex items-start gap-3 text-xs">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-mono shrink-0">
                  {entry.seq}
                </div>
                {i < CHAIN_ENTRIES.length - 1 && <div className="w-px h-4 bg-gray-300" />}
              </div>
              <div className="border border-gray-200 rounded-lg px-3 py-2 flex-1 mt-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-xs font-mono text-gray-700 font-medium">{entry.action}</code>
                  <span className="text-gray-400">agent: {entry.agent}</span>
                </div>
                <div className="text-gray-400 font-mono">
                  <span className="text-gray-500">hash:</span> {entry.hash}{' '}
                  <span className="text-gray-500">prev:</span> {entry.prevHash}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          SHA-256(entry_data + prev_hash). Modify any entry → all subsequent hashes mismatch.
          Verify with: <code className="bg-gray-100 px-1 rounded">agent-identity audit verify --from 2026-01-01 --to 2026-03-31</code>
        </p>
      </div>

      {/* CLI reference */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">CLI reference</div>
        <div className="space-y-2">
          {[
            { cmd: 'agent-identity audit verify --from 2026-01-01 --to 2026-03-31', desc: 'Verify hash chain integrity for date range' },
            { cmd: 'agent-identity report soc2 --from 2026-01-01 --to 2026-03-31', desc: 'Generate SOC 2 CC6 report' },
            { cmd: 'agent-identity report gdpr --format markdown', desc: 'GDPR Article 30 report as Markdown' },
            { cmd: 'agent-identity report hipaa --output ./reports/', desc: 'HIPAA §164.312 report to directory' },
          ].map(({ cmd, desc }) => (
            <div key={cmd}>
              <code className="text-xs font-mono bg-gray-950 text-gray-300 px-2 py-1 rounded block mb-0.5">{cmd}</code>
              <span className="text-xs text-gray-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Code snippet */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Integration</div>
        <pre className="bg-gray-950 rounded-md p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed"><code>{snippet}</code></pre>
      </div>
    </div>
  );
}
