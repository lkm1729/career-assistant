import type { ConnectionInfo } from '../shared/ai';
import { useEffect, useRef, useState } from 'react';
import type { MatchConfirmation, MatchRecord } from '../shared/matching';
import type { AiState } from './useAi';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
export function useMatch(flush: () => Promise<boolean>, ai: AiState, visible = true) {
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const lock = useRef(false);
  const cancelLock = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const [sendImages, setSendImages] = useState(false);
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const running = useRef<string | null>(null);
  const [runningConnection, setRunningConnection] = useState<ConnectionInfo | null>(null);
  const [confirmation, setConfirmation] = useState<MatchConfirmation | null>(null),
    [records, setRecords] = useState<MatchRecord[]>([]),
    [current, setCurrent] = useState<MatchRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<AiDiagnostic | null>(null);
  useEffect(() => {
    if (!visible && previewRunId) {
      void window.career!.match.discardFailedPreview(previewRunId).catch(() => {});
      setPreviewRunId(null);
    }
  }, [visible, previewRunId]);
  const revision = useRef('initial');
  const refreshSequence = useRef(0);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const [list, state] = await Promise.all([
      window.career!.match.history(),
      window.career!.workbench.inspect('match'),
    ]);
    if (sequence !== refreshSequence.current) return;
    revision.current = state.revision;
    setRecords(list);
    setCurrent(
      state.assessment?.page === 'match'
        ? state.assessment.record
        : (list.find((r) => r.id === state.currentId) ?? null),
    );
  }
  useEffect(() => {
    void refresh().catch(() => setError(messageDiagnostic('无法读取匹配历史。')));
  }, []);
  async function deleteMany(ids: string[], expectedRevision: string) {
    if (lock.current || ai.busy || ai.testing || !ids.length) return false;
    lock.current = true;
    ai.setExtraBusy(true);
    setError(null);
    try {
      const result = await window.career!.match.deleteMany(ids, expectedRevision);
      if (!result.ok) {
        setError(result.diagnostic);
        await refresh();
        return false;
      }
      setConfirmation(null);
      await refresh();
      setMessage(`已删除 ${result.deleted} 条独立匹配历史。`);
      return true;
    } catch {
      setError(messageDiagnostic('删除匹配历史失败，未确认删除结果；请刷新后重试。'));
      return false;
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
    }
  }
  async function selectCurrent(record: MatchRecord) {
    if (lock.current || ai.busy || ai.testing) return;
    lock.current = true;
    ai.setExtraBusy(true);
    setError(null);
    try {
      const result = await window.career!.workbench.select('match', record.id, revision.current);
      if (!result.ok) setError(result.diagnostic);
      await refresh();
    } catch {
      setError(messageDiagnostic('恢复匹配显示失败，请重试；历史未删除。'));
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
    }
  }
  return {
    runningConnection,
    sendImages,
    setSendImages,
    confirmation,
    setConfirmation,
    records,
    current,
    setCurrent: selectCurrent,
    deleteMany,
    historyRevision: revision.current,
    refresh,
    selectionDisabled: ai.busy || !!ai.testing,
    resetResultFeedback: () => {
      setMessage('');
      setError(null);
      setConfirmation(null);
      setPreviewRunId(null);
    },
    busy,
    preparing,
    cancelling,
    message,
    error,
    previewRunId,
    prepare: async () => {
      if (ai.busy || ai.testing || lock.current) return;
      lock.current = true;
      setPreparing(true);
      ai.setExtraBusy(true);
      setMessage('');
      setError(null);
      setPreviewRunId(null);
      try {
        if (!(await flush())) throw new Error('草稿未保存');
        const r = await window.career!.match.prepare(sendImages);
        if (r.ok) setConfirmation(r.value);
        else setError(r.diagnostic);
      } catch {
        setError(messageDiagnostic('无法准备匹配，请先保存草稿后重试。'));
      } finally {
        setPreparing(false);
        ai.setExtraBusy(false);
        lock.current = false;
      }
    },
    run: async () => {
      if (!confirmation || ai.busy || ai.testing || lock.current) return;
      lock.current = true;
      ai.setExtraBusy(true);
      const c = confirmation;
      setRunningConnection(c.connection);
      setConfirmation(null);
      setBusy(true);
      setCancelling(false);
      cancelLock.current = false;
      setMessage('');
      setError(null);
      setPreviewRunId(null);
      running.current = c.runId;
      try {
        const r = await window.career!.match.run(c);
        if (r.ok) {
          setCurrent(r.value);
          setMessage('匹配结果已保存，可查看匹配依据与局限。');
          await refresh();
        } else {
          setError(r.diagnostic);
          if (r.previewAvailable) {
            if (visibleRef.current) setPreviewRunId(c.runId);
            else await window.career!.match.discardFailedPreview(c.runId);
          }
        }
      } catch {
        setError(messageDiagnostic('匹配通信失败，未保存匹配记录。'));
      } finally {
        running.current = null;
        setRunningConnection(null);
        setBusy(false);
        setCancelling(false);
        cancelLock.current = false;
        lock.current = false;
        ai.setExtraBusy(false);
      }
    },
    cancel: async () => {
      if (cancelLock.current) return;
      if (!running.current) {
        setConfirmation(null);
        return;
      }
      cancelLock.current = true;
      setCancelling(true);
      try {
        await window.career!.match.cancel(running.current);
      } catch {
        setCancelling(false);
        cancelLock.current = false;
        setError(messageDiagnostic('取消请求未确认，请等待当前匹配结束或重试取消。'));
      }
    },
  };
}
export type MatchState = ReturnType<typeof useMatch>;
