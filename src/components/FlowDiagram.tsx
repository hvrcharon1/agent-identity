import type { FlowNode } from '@/lib/types';

const variantClasses: Record<FlowNode['variant'], string> = {
  default: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
};

interface FlowDiagramProps {
  label: string;
  nodes: FlowNode[];
}

export function FlowDiagram({ label, nodes }: FlowDiagramProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {nodes.map((node, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`rounded-lg border px-3 py-2 ${variantClasses[node.variant]}`}>
              <p className="text-xs font-medium whitespace-nowrap">{node.label}</p>
              <p className="text-[10px] opacity-60 whitespace-nowrap">{node.sublabel}</p>
            </div>
            {i < nodes.length - 1 && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#d1d5db"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0"
                aria-hidden="true"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
