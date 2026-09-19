import { useEffect, useRef } from 'react';
import { ActionFeedback } from './ActionFeedback';
import { useAi } from './useAi';
import type { WorkspaceId } from '../shared/contracts';
import type { ScoreState } from './useScore';
import type { MatchState } from './useMatch';
export function WorkbenchFeedback({
  id,
  score,
  match,
  label,
  announce = true,
}: {
  id: WorkspaceId;
  score?: ScoreState;
  match?: MatchState;
  label?: string;
  announce?: boolean;
}) {
  const ai = useAi();
  const state = id === 'match' ? match : id === 'score' ? score : null;
  const name =
    id === 'match' ? '岗位匹配' : id === 'score' ? '简历评分' : id === 'letter' ? '求职信' : '简历';
  const pending = state ? state.busy || state.preparing : ai.pageBusy;
  const local = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending || !announce) return;
    const frame = requestAnimationFrame(() =>
      local.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [pending, announce]);
  const preparing = state ? state.preparing : ai.preparing;
  const cancelling = state ? state.cancelling : ai.cancelling;
  const error = state ? state.error : ai.diagnostic;
  const message = pending
    ? cancelling
      ? '正在请求停止，等待当前操作结束…'
      : preparing
        ? '正在保存草稿并准备发送确认；尚未调用模型…'
        : state
          ? id === 'match'
            ? '正在对照岗位要求与本页资料，校验完成后保存匹配结果…'
            : '正在按四维量表评分，校验完成后保存结果…'
          : ai.generating
            ? `正在起草${name}，完整结果校验后才会保存…`
            : '正在保存本地操作，请稍候…'
    : error
      ? `本次操作未完成：${error.message}（${error.code}）`
      : state
        ? state.message
        : ai.message;
  return (
    <div ref={local}>
      <ActionFeedback
        announce={announce}
        label={label ?? `${name}操作反馈`}
        pending={pending}
        message={message ?? ''}
        error={!pending && !!error}
        cancelling={cancelling}
        cancelLabel={
          id === 'match' ? '停止本次匹配' : id === 'score' ? '停止本次评分' : '停止本次生成'
        }
        onCancel={
          !preparing && (state?.busy || (ai.generating && ai.pageBusy))
            ? () => {
                void (state ? state.cancel() : ai.cancel());
              }
            : undefined
        }
      />
    </div>
  );
}
