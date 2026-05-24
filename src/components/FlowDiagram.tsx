import type { FlowNode } from '@/lib/types';
import { ArrowRight } from 'lucide-react';

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
              <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
