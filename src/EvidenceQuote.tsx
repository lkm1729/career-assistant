import { FileText } from 'lucide-react';
import { referenceLabel } from '../shared/reference-display';
export function EvidenceQuote({
  sourceId,
  quote,
  labels,
  kind,
}: {
  sourceId: string;
  quote: string;
  labels: ReadonlyMap<string, string>;
  kind?: string;
}) {
  return (
    <blockquote className="evidence-quote">
      <div className="evidence-caption">
        <FileText size={14} aria-hidden="true" />
        <span>
          {kind ? `${kind} · ` : ''}
          {referenceLabel(sourceId, labels)}
        </span>
      </div>
      <p>{quote}</p>
      <details className="evidence-technical">
        <summary>引用技术详情</summary>
        <code>{sourceId}</code>
      </details>
    </blockquote>
  );
}
