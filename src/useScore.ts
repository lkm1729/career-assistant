import type { ConnectionInfo } from '../shared/ai';
import { useState, useEffect, useRef } from 'react';
import type { AiState } from './useAi';
import type { ScoreConfirmation, ScoreRecord } from '../shared/scoring';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
export function useScore(flush: () => Promise<boolean>, ai: AiState, visible = true) {
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ScoreConfirmation | null>(null);
  useEffect(() => {
    if (!visible) {
      setPreviewRunId(null);
      setConfirmation(null);
    }
  }, [visible]);
  useEffect(() => {
    if (!previewRunId) return;
    if (!visible) {
      void window.career!.score.discardFailedPreview(previewRunId).catch(() => {});
      setPreviewRunId(null);
    }
    return () => {
      void window.career!.score.discardFailedPreview(previewRunId).catch(() => {});
    };
  }, [previewRunId, visible]);
  const [records, setRecords] = useState<ScoreRecord[]>([]);
  const [current, setCurrent] = useState<ScoreRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendImages, setSendImages] = useState(true);
  const [error, setError] = useState<AiDiagnostic | null>(null);
  const running = useRef<string | null>(null);
  const [runningConnection, setRunningConnection] = useState<ConnectionInfo | null>(null);
  const lock = useRef(false);
  const cancelLock = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef('initial');
  const refreshSequence = useRef(0);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const [list, state] = await Promise.all([
      window.career!.score.history(),
      window.career!.workbench.inspect('score'),
    ]);
    if (sequence !== refreshSequence.current) return;
    revision.current = state.revision;
    setRecords(list);
    setCurrent(
      state.assessment?.page === 'score'
        ? state.assessment.record
        : (list.find((r) => r.id === state.currentId) ?? null),
    );
  }
  async function deleteMany(ids: string[], expectedRevision: string) {
    if (lock.current || ai.busy || ai.testing || !ids.length) return false;
    lock.current = true;
    ai.setExtraBusy(true);
    setError(null);
    try {
      const result = await window.career!.score.deleteMany(ids, expectedRevision);
      if (!result.ok) {
        setError(result.diagnostic);
        await refresh();
        return false;
      }
      setConfirmation(null);
      await refresh();
      setMessage(`已删除 ${result.deleted} 条独立评估历史。`);
      return true;
    } catch {
      setError(messageDiagnostic('删除评估历史失败，未确认删除结果；请刷新后重试。'));
      return false;
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
    }
  }
  async function selectCurrent(record: ScoreRecord) {
    if (lock.current || ai.busy || ai.testing) return;
    lock.current = true;
    ai.setExtraBusy(true);
    setError(null);
    try {
      const result = await window.career!.workbench.select('score', record.id, revision.current);
      if (!result.ok) setError(result.diagnostic);
      await refresh();
    } catch {
      setError(messageDiagnostic('恢复评估显示失败，请重试；历史未删除。'));
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
    }
  }
  useEffect(() => {
    void refresh().catch(() => setError(messageDiagnostic('无法读取评分历史，请重试。')));
  }, []);
  async function prepare() {
    if (lock.current || ai.busy || ai.testing) return;
    lock.current = true;
    setPreparing(true);
    setPreviewRunId(null);
    setConfirmation(null);
    ai.setExtraBusy(true);
    setMessage('');
    setError(null);
    try {
      if (!(await flush())) throw new Error();
      const r = await window.career!.score.prepare(sendImages);
      if (r.ok) setConfirmation({ ...r.value, retainFailedResponse: false });
      else setError(r.diagnostic);
    } catch {
      setError(messageDiagnostic('本地读取或保存失败，尚未发送评分请求。'));
    } finally {
      setPreparing(false);
      ai.setExtraBusy(false);
      lock.current = false;
    }
  }
  async function run() {
    if (!confirmation || lock.current || ai.busy || ai.testing) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setCancelling(false);
    cancelLock.current = false;
    ai.setExtraBusy(true);
    const request = confirmation;
    setRunningConnection(request.connection);
    setConfirmation(null);
    running.current = request.runId;
    setError(null);
    try {
      const r = await window.career!.score.run(request);
      if (r.ok) {
        setCurrent(r.value);
        await refresh();
        setMessage('评分结果已保存，可查看各维度建议。');
      } else {
        setError(r.diagnostic);
        if (r.previewAvailable) setPreviewRunId(request.runId);
      }
    } catch {
      setError(messageDiagnostic('评分通信失败，请查看历史后再重试，避免重复计费。'));
    } finally {
      setBusy(false);
      setCancelling(false);
      cancelLock.current = false;
      ai.setExtraBusy(false);
      running.current = null;
      setRunningConnection(null);
      lock.current = false;
    }
  }
  return {
    previewRunId,
    confirmation,
    setConfirmation,
    records,
    current,
    setCurrent: selectCurrent,
    deleteMany,
    historyRevision: revision.current,
    selectionDisabled: ai.busy || !!ai.testing,
    resetResultFeedback: () => {
      setPreviewRunId(null);
      setMessage('');
      setError(null);
      setConfirmation(null);
    },
    busy,
    preparing,
    cancelling,
    message,
    runningConnection,
    sendImages,
    setSendImages,
    error,
    prepare,
    run,
    cancel: async () => {
      if (!running.current || cancelLock.current) return;
      cancelLock.current = true;
      setCancelling(true);
      try {
        await window.career!.score.cancel(running.current);
      } catch {
        cancelLock.current = false;
        setCancelling(false);
        setError(messageDiagnostic('取消请求未确认，请等待当前评分结束或重试取消。'));
      }
    },
    refresh,
  };
}
export type ScoreState = ReturnType<typeof useScore>;
