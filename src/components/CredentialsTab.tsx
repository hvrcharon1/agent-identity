import { Info, Database, Mail, CheckCircle2, Clock } from 'lucide-react';
import { DEFAULT_CREDENTIALS, DEFAULT_ROUTING_RULES } from '@/lib/credentials';
import type { Credential } from '@/lib/types';

const CRED_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Linear: ({ className }) => <span className={`text-sm font-bold ${className}`}>L</span>,
  PostgreSQL: Database,
  Notion: ({ className }) => <span className={`text-sm font-bold ${className}`}>N</span>,
  Google: Mail,
};

function CredRow({ cred }: { cred: Credential }) {
  const Icon = CRED_ICONS[cred.provider ?? ''] ?? Database;
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          cred.kind === 'fixed' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{cred.name}</p>
        <p className="text-xs text-gray-400">{cred.scope}</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {cred.status === 'active' ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-gray-400">Active</span>
          </>
        ) : (
          <>
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-gray-400">Pending</span>
          </>
        )}
      </div>
    </div>
  );
}

export function CredentialsTab() {
  const fixed = DEFAULT_CREDENTIALS.filter((c) => c.kind === 'fixed');
  const delegated = DEFAULT_CREDENTIALS.filter((c) => c.kind === 'user-delegated');

  return (
    <div className="space-y-5">
      <div className="flex gap-2 p-3 rounded-lg bg-blue-50 text-blue-700">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Credentials are stored encrypted and never passed to the model. The agent resolves which credential to attach to each outbound call at routing time.
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Fixed credentials (shared)</p>
        <div className="space-y-2">
          {fixed.map((c) => <CredRow key={c.id} cred={c} />)}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">User-delegated slots (per-user)</p>
        <div className="space-y-2">
          {delegated.map((c) => <CredRow key={c.id} cred={c} />)}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Routing rules</p>
        <div className="space-y-2">
          {DEFAULT_ROUTING_RULES.map((rule) => (
            <div key={rule.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs font-medium">
                {rule.resourceKind === 'shared' ? (
                  <>If task targets shared tool → use <span className="text-red-600">fixed credential</span></>
                ) : (
                  <>If task touches personal resource → use <span className="text-blue-600">user-delegated token</span></>
                )}
              </p>
              <p className="text-xs text-gray-400">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
