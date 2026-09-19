import { ArrowDownToLine, Sparkles, LoaderCircle } from 'lucide-react';
import type { WorkspaceId } from '../shared/contracts';
export function ResultHeader({
  title,
  status,
  pending = false,
}: {
  title: string;
  status: string;
  pending?: boolean;
}) {
  return (
    <div className="result-heading">
      <span className="result-mark" aria-hidden="true">
        {pending ? <LoaderCircle size={22} className="spin" /> : <Sparkles size={22} />}
      </span>
      <div className="result-heading-copy">
        <span className="result-eyebrow">AI 回答区</span>
        <h2>{title}</h2>
      </div>
      <span className="result-state">{status}</span>
    </div>
  );
}
export function ResultJump({ page }: { page: WorkspaceId }) {
  return (
    <button
      type="button"
      className="result-jump secondary"
      onClick={() => {
        const target = document.getElementById(`ai-result-${page}`);
        if (!target) return;
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        target.focus({ preventScroll: true });
      }}
    >
      <ArrowDownToLine size={16} aria-hidden="true" />
      查看 AI 结果
    </button>
  );
}
