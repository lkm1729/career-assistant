import { useEffect, useRef, useState } from 'react';
import type { InterviewConfirmation, InterviewRecord } from '../shared/interview';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import type { AiState } from './useAi';
export function useInterview(flush: () => Promise<boolean>, ai: AiState) {
  const lock = useRef(false),
    running = useRef<string | null>(null);
  const [sendImages, setSendImages] = useState(false);
  const [confirmation, setConfirmation] = useState<InterviewConfirmation | null>(null);
  const [records, setRecords] = useState<InterviewRecord[]>([]);
  const [current, setCurrent] = useState<InterviewRecord | null>(null);
  const [revision, setRevision] = useState('initial');
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<AiDiagnostic | null>(null);
  const [message, setMessage] = useState('');
  const [runningConnection, setRunningConnection] = useState<InterviewRecord['connection'] | null>(
    null,
  );
  async function refresh() {
    const [list, state] = await Promise.all([
      window.career!.interview.history(),
      window.career!.workbench.inspect('interview'),
    ]);
    setRecords(list);
    setRevision(state.revision);
    setCurrent(
      state.assessment?.page === 'interview'
        ? state.assessment.record
        : (list.find((r) => r.id === state.currentId) ?? null),
    );
  }
  useEffect(() => {
    void refresh().catch(() => setError(messageDiagnostic('无法读取面试记录。')));
  }, []);
  async function action<T>(run: () => Promise<T>) {
    if (lock.current || ai.busy || ai.testing) return;
    lock.current = true;
    ai.setExtraBusy(true);
    try {
      return await run();
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
    }
  }
  return {
    sendImages,
    setSendImages,
    confirmation,
    setConfirmation,
    records,
    current,
    revision,
    busy,
    preparing,
    error,
    message,
    runningConnection,
    selectionDisabled: ai.busy || !!ai.testing || busy || preparing,
    refresh,
    resetResultFeedback: () => {
      setError(null);
      setMessage('');
      setConfirmation(null);
    },
    prepare: () =>
      action(async () => {
        setPreparing(true);
        setError(null);
        try {
          if (!(await flush())) throw new Error('保存失败');
          const result = await window.career!.interview.prepare(sendImages);
          if (result.ok) setConfirmation(result.value);
          else setError(result.diagnostic);
        } catch {
          setError(messageDiagnostic('无法准备面试问答，请检查草稿及模型配置。'));
        } finally {
          setPreparing(false);
        }
      }),
    run: () =>
      action(async () => {
        if (!confirmation) return;
        const request = confirmation;
        setConfirmation(null);
        setBusy(true);
        setError(null);
        setRunningConnection(request.connection);
        running.current = request.runId;
        try {
          const result = await window.career!.interview.run(request);
          if (result.ok) {
            setCurrent(result.value);
            setMessage('20组英文面试问答已保存到本页记录。');
            await refresh();
          } else setError(result.diagnostic);
        } catch {
          setError(messageDiagnostic('面试问答通信失败；请查看记录，避免重复付费请求。'));
        } finally {
          running.current = null;
          setRunningConnection(null);
          setBusy(false);
        }
      }),
    cancel: async () => {
      if (running.current) await window.career!.interview.cancel(running.current);
    },
    select: (record: InterviewRecord) =>
      action(async () => {
        try {
          const result = await window.career!.workbench.select('interview', record.id, revision);
          if (!result.ok) setError(result.diagnostic);
          await refresh();
        } catch {
          setError(messageDiagnostic('无法显示这条面试记录，请刷新后重试。'));
        }
      }),
    deleteMany: async (ids: string[], expectedRevision: string) => {
      const result = await action(async () => {
        try {
          const reply = await window.career!.interview.deleteMany(ids, expectedRevision);
          if (!reply.ok) setError(reply.diagnostic);
          await refresh();
          return reply.ok;
        } catch {
          setError(messageDiagnostic('删除面试记录失败；请刷新确认结果。'));
          return false;
        }
      });
      return result ?? false;
    },
  };
}
export type InterviewState = ReturnType<typeof useInterview>;
