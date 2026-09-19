import { versionLabel } from '../shared/version-display';
import type { MaterialManifest } from '../shared/materials';
import { wireParameters, resolvedConnection, type Catalog } from '../shared/models';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  ConnectionInfo,
  GenerationRequest,
  HistoryState,
  WritingPage,
  VersionReference,
  HistoryReply,
} from '../shared/ai';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import type { Snapshot, WorkspaceDraft } from '../shared/contracts';
const emptyHistory = (): HistoryState => ({ versions: [], deleted: [], checkpoints: [] });
type TestOperation =
  | { modelId: string; revision: string; kind: 'text' | 'image' }
  | { providerId: string; revision: string; kind: 'provider' | 'discovery' };
export function useAiState(
  snapshot: Snapshot | null,
  flush: () => Promise<boolean>,
  reload: (page?: WritingPage) => Promise<void>,
) {
  const page: WritingPage = snapshot?.preferences.activeTab === 'letter' ? 'letter' : 'resume';
  const [extraBusy, setExtraBusy] = useState(false);
  const [runningConnection, setRunningConnection] = useState<ConnectionInfo | null>(null);
  const [sendImages, setSendImages] = useState(false);
  const [confirmationMaterials, setConfirmationMaterials] = useState<MaterialManifest | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const connection = catalog ? resolvedConnection(catalog, page) : null;
  const [histories, setHistories] = useState<Record<WritingPage, HistoryState>>({
    resume: emptyHistory(),
    letter: emptyHistory(),
  });
  const [working, setWorking] = useState<'prepare' | 'generate' | 'rollback' | 'history' | null>(
    null,
  );
  const [operationPage, setOperationPage] = useState<WritingPage>('resume');
  const [testing, setTesting] = useState<TestOperation | null>(null);
  const [feedback, setFeedback] = useState<{
    page: WritingPage;
    message: string;
    diagnostic?: AiDiagnostic;
  } | null>(null);
  const [stream, setStream] = useState('');
  const [confirmation, setConfirmation] = useState<GenerationRequest | null>(null);
  const [confirmationConnection, setConfirmationConnection] = useState<ConnectionInfo | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState<{
    page: WritingPage;
    number: number;
    expectedDraft: WorkspaceDraft;
  } | null>(null);
  const running = useRef<string | null>(null);
  const cancelLock = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const lock = useRef(false);
  const pendingText = useRef('');
  const refreshSequence = useRef(0);
  const history = histories[page];
  function notice(target: WritingPage, message: string, diagnostic?: AiDiagnostic) {
    setFeedback({ page: target, message, diagnostic });
  }
  function fail(target: WritingPage, error: unknown) {
    const message = error instanceof Error ? error.message : '本地操作失败，请保留资料并重试。';
    notice(target, message, messageDiagnostic(message));
  }
  async function refresh() {
    if (!window.career) return;
    const sequence = ++refreshSequence.current;
    try {
      const [info, resume, letter] = await Promise.all([
        window.career.ai.registry.catalog(),
        window.career.ai.getHistory('resume'),
        window.career.ai.getHistory('letter'),
      ]);
      if (sequence !== refreshSequence.current) return;
      setCatalog(info);
      setHistories({ resume, letter });
    } catch {
      notice(
        page,
        '无法读取模型配置或版本记录，请重启重试；未清空任何资料。',
        messageDiagnostic('无法读取模型配置或版本记录。'),
      );
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    const unsubscribe = window.career?.ai.onGeneration((event) => {
      if (event.runId === running.current) pendingText.current += event.text;
    });
    const interval = setInterval(() => {
      if (running.current) setStream(pendingText.current);
    }, 80);
    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, []);
  function acquire(kind: NonNullable<typeof working>, target: WritingPage) {
    if (!window.career || lock.current || testing || extraBusy) return false;
    lock.current = true;
    setWorking(kind);
    setOperationPage(target);
    setFeedback(null);
    return true;
  }
  function release() {
    lock.current = false;
    setWorking(null);
  }
  async function savedDraft(target: WritingPage) {
    if (!(await flush())) throw new Error('草稿尚未保存，请先重试保存。');
    return (await window.career!.load()).workspaces[target];
  }
  async function prepare(mode: 'generate' | 'refine' = 'generate') {
    const target = page;
    if (!connection || !acquire('prepare', target)) return;
    try {
      wireParameters(connection.parameters ?? {}, connection.protocol);
      const draft = await savedDraft(target);
      const materialManifest = await window.career!.materials.manifest(target, sendImages);
      if (mode === 'generate' && !draft.prompt.trim() && !materialManifest?.items.length)
        throw new Error('请先填写经历或选中本页参考资料。');
      setConfirmationMaterials(materialManifest);
      if (mode === 'refine' && (!draft.refinement.trim() || !draft.document.trim()))
        throw new Error(!draft.document.trim() ? '请先生成或填写当前正文。' : '请先填写修改要求。');
      setConfirmationConnection(connection);
      const workbench = await window.career!.workbench.inspect(target);
      setConfirmation({
        workbenchRevision: workbench.revision,
        page: target,
        ...(materialManifest
          ? { materials: { revision: materialManifest.revision, sendImages } }
          : {}),
        runId: crypto.randomUUID(),
        revision: connection.revision,
        input: {
          prompt: draft.prompt,
          systemPrompt: draft.systemPrompt,
          document: draft.document,
          ...(target === 'letter'
            ? { resumeText: draft.resumeText ?? '', evidenceText: draft.evidenceText ?? '' }
            : {}),
        },
        operation: mode,
        refinement: mode === 'refine' ? draft.refinement : undefined,
      });
    } catch (error) {
      fail(target, error);
    } finally {
      release();
    }
  }
  async function generate() {
    if (!confirmation) return;
    const request = confirmation;
    const target = request.page ?? 'resume';
    if (!acquire('generate', target)) return;
    setRunningConnection(confirmationConnection);
    setConfirmation(null);
    running.current = request.runId;
    cancelLock.current = false;
    setCancelling(false);
    pendingText.current = '';
    setStream('');
    try {
      const result = await window.career!.ai.generateDocument(request);
      if (result.ok) {
        await reload(target);
        await refresh();
        notice(
          target,
          `已保存正式版本 V${result.version.displayNumber}，正文、建议和说明已独立保存。`,
        );
      } else notice(target, result.message, result.diagnostic ?? messageDiagnostic(result.message));
    } catch {
      fail(target, new Error('生成通信失败，请查看历史确认是否保存，避免重复付费请求。'));
    } finally {
      running.current = null;
      setRunningConnection(null);
      cancelLock.current = false;
      setCancelling(false);
      pendingText.current = '';
      setStream('');
      release();
    }
  }
  async function prepareRestore(number: number) {
    if (!acquire('prepare', page)) return;
    try {
      setRestoreConfirmation({ page, number, expectedDraft: await savedDraft(page) });
    } catch (error) {
      fail(page, error);
    } finally {
      release();
    }
  }
  async function applyVersion(target: WritingPage, number: number, expected?: WorkspaceDraft) {
    if (!acquire('rollback', target)) return false;
    try {
      const current = await savedDraft(target);
      const result = await window.career!.ai.restoreDocumentVersion(
        target,
        number,
        expected ?? current,
      );
      setRestoreConfirmation(null);
      if (!result.ok) {
        notice(target, result.message, result.diagnostic ?? messageDiagnostic(result.message));
        return false;
      }
      await reload(target);
      await refresh();
      notice(
        target,
        `当前工作区已回到 ${versionLabel(histories[target].versions, number)}，未创建新版本。可继续编辑；切换前草稿可在本页记录恢复。`,
      );
      return true;
    } catch (error) {
      setRestoreConfirmation(null);
      fail(target, error);
      return false;
    } finally {
      release();
    }
  }
  async function restoreVersion() {
    if (restoreConfirmation)
      return applyVersion(
        restoreConfirmation.page,
        restoreConfirmation.number,
        restoreConfirmation.expectedDraft,
      );
  }
  async function switchVersion(number: number) {
    return applyVersion(page, number);
  }
  async function mutateHistory(
    action: (target: WritingPage, expected: WorkspaceDraft) => Promise<HistoryReply>,
    success: string,
  ) {
    const target = page;
    if (!acquire('history', target)) return false;
    try {
      const result = await action(target, await savedDraft(target));
      if (!result.ok) {
        notice(target, result.message, result.diagnostic ?? messageDiagnostic(result.message));
        await refresh();
        return false;
      }
      setHistories((current) => ({ ...current, [target]: result.history }));
      await reload(target);
      notice(target, success);
      return true;
    } catch (error) {
      fail(target, error);
      return false;
    } finally {
      release();
    }
  }
  const deleteVersions = (items: VersionReference[]) =>
    mutateHistory(
      (target, expected) => window.career!.ai.deleteVersions(target, items, expected),
      '所选旧版本已移入回收站，可撤销；当前工作区未改变。',
    );
  const recoverVersions = (items: VersionReference[]) =>
    mutateHistory(
      (target) => window.career!.ai.recoverVersions(target, items),
      '所选版本已从回收站恢复，未新增编号或切换工作区。',
    );
  const recoverDraft = (id: string) =>
    mutateHistory(
      (target, expected) => window.career!.ai.recoverDraft(target, id, expected),
      '已恢复所选草稿备份；恢复前内容也已备份，可继续恢复。',
    );
  const purgeVersions = (items: VersionReference[]) =>
    mutateHistory(
      (target) => window.career!.ai.purgeVersions(target, items),
      '所选版本已永久删除，当前工作区未改变。',
    );
  const deleteDrafts = (ids: string[]) =>
    mutateHistory(
      (target) => window.career!.ai.deleteDrafts(target, ids),
      `已永久删除 ${ids.length} 条草稿备份，当前工作区未改变。`,
    );
  async function cancel() {
    if (!running.current || !window.career || cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    try {
      await window.career.ai.cancelGeneration(running.current);
    } catch {
      cancelLock.current = false;
      setCancelling(false);
      fail(operationPage, new Error('取消请求未确认，请等待当前请求结束。'));
    }
  }
  return {
    page,
    documentLabel: page === 'resume' ? '简历' : '求职信',
    operationPage,
    testing,
    setTesting,
    catalog,
    setCatalog,
    connection,
    runningConnection: operationPage === page ? runningConnection : null,
    versions: history.versions,
    deletedVersions: history.deleted,
    checkpoints: history.checkpoints,
    busy: working !== null || extraBusy,
    extraBusy,
    setExtraBusy,
    sendImages,
    setSendImages,
    confirmationMaterials,
    pageBusy: working !== null && operationPage === page,
    generating: working === 'generate',
    preparing: working === 'prepare' && operationPage === page,
    cancelling,
    restoring: working === 'rollback',
    restoreConfirmation,
    setRestoreConfirmation,
    prepareRestore,
    switchVersion,
    deleteVersions,
    recoverVersions,
    purgeVersions,
    recoverDraft,
    deleteDrafts,
    currentDocument: snapshot?.workspaces[page].document ?? '',
    currentVersionNumber: snapshot?.workspaces[page].currentVersionNumber ?? null,
    stream: operationPage === page ? stream : '',
    message: feedback?.page === page ? feedback.message : '',
    diagnostic: feedback?.page === page ? feedback.diagnostic : undefined,
    confirmation,
    confirmationConnection,
    setConfirmation,
    refresh,
    resetResultFeedback: () => {
      setFeedback(null);
      setConfirmation(null);
      setRestoreConfirmation(null);
    },
    prepare,
    prepareRefinement: () => prepare('refine'),
    generate,
    cancel,
    restoreVersion,
  };
}
export type AiState = ReturnType<typeof useAiState>;
export const AiContext = createContext<AiState | null>(null);
export function useAi() {
  const value = useContext(AiContext);
  if (!value) throw new Error('Missing AI context');
  return value;
}
