import { LoaderCircle, CircleCheck, CircleAlert } from 'lucide-react';
/** Fixed stage messages only: never place token-by-token output in this live region. */
export function ActionFeedback({
  label,
  pending = false,
  message,
  error = false,
  onCancel,
  cancelLabel = '取消操作',
  cancelling = false,
  announce = true,
}: {
  label: string;
  pending?: boolean;
  message: string;
  error?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  cancelling?: boolean;
  announce?: boolean;
}) {
  if (!message) return null;
  return (
    <section
      className={`action-feedback${error ? ' action-feedback-error' : ''}`}
      aria-label={label}
      data-pending={pending}
    >
      <div
        className="action-feedback-message"
        role={announce ? 'status' : undefined}
        aria-live={announce ? 'polite' : 'off'}
        aria-atomic="true"
      >
        {pending ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : error ? (
          <CircleAlert size={17} aria-hidden="true" />
        ) : (
          <CircleCheck size={17} aria-hidden="true" />
        )}
        <span className={pending ? 'ai-thinking' : undefined}>{message}</span>
      </div>
      {pending && onCancel && (
        <button className="secondary" disabled={cancelling} onClick={onCancel}>
          {cancelling ? '正在请求停止…' : cancelLabel}
        </button>
      )}
    </section>
  );
}
