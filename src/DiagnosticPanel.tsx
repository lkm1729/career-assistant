import { AlertCircle } from 'lucide-react';
import type { AiDiagnostic } from '../shared/diagnostics';
export function DiagnosticPanel({ diagnostic }: { diagnostic: AiDiagnostic }) {
  return (
    <section className="ai-error" role="alert" aria-label="错误诊断">
      <h4>
        <AlertCircle size={18} />{' '}
        {diagnostic.httpStatus && (
          <strong className="http-status">HTTP {diagnostic.httpStatus}</strong>
        )}{' '}
        {diagnostic.message}
      </h4>
      <details open={!diagnostic.httpStatus}>
        <summary>技术诊断详情</summary>
        <strong>
          报错码：<code>{diagnostic.code}</code>
        </strong>
      </details>
      <strong>可能原因（并非已确认）：</strong>
      <ul>
        {diagnostic.possibleCauses.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      <strong>建议解决办法：</strong>
      <ul>
        {diagnostic.solutions.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}
