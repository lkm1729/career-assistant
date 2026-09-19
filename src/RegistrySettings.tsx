import { ModelDiscovery } from './ModelDiscovery';
import { ActionFeedback } from './ActionFeedback';
import { ProviderProbe } from './ProviderProbe';
import { DiagnosticPanel } from './DiagnosticPanel';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  LoaderCircle,
  ShieldCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAi } from './useAi';
import { pages } from './content';
import { protocolEndpoint, protocolLabel, type Protocol } from '../shared/ai';
import {
  emptyCapabilities,
  emptyParameters,
  modelConnection,
  validateModel,
  type ProviderInfo,
  type ModelInfo,
  type ModelInput,
  type DeleteRequest,
  type RegistryReply,
  type TestReceipt,
  type Capabilities,
  type ParameterSupport,
} from '../shared/models';
import { ParameterFields } from './ParameterFields';
import { ListPager, listPage } from './ListPager';

type Editor =
  | { kind: 'provider'; value: ProviderInfo | null }
  | { kind: 'model'; value: ModelInfo | null; providerId: string };
export function RegistrySettings() {
  const ai = useAi();
  const catalog = ai.catalog;
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelView, setModelView] = useState({ providerId: '', query: '', page: 0 });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [checkedProviders, setCheckedProviders] = useState<string[]>([]);
  const [checkedModels, setCheckedModels] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<DeleteRequest | null>(null);
  const [test, setTest] = useState<{
    modelId: string;
    revision: string;
    kind: 'text' | 'image';
  } | null>(null);
  const testConfirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (test && !editor) {
      testConfirmation.current?.scrollIntoView({ block: 'nearest' });
      testConfirmation.current?.focus({ preventScroll: true });
    }
  }, [test, editor]);
  const [working, setWorking] = useState(false);
  const mutationLock = useRef(false);
  const testLock = useRef(false);
  const cancelLock = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [testResult, setTestResult] = useState<{
    modelId: string;
    message: string;
    diagnostic?: AiDiagnostic;
  } | null>(null);
  const [noticeLocation, setNoticeLocation] = useState('providers');
  const [removedProvider, setRemovedProvider] = useState<{
    value: ProviderInfo;
    index: number;
  } | null>(null);
  const [removedModel, setRemovedModel] = useState<{ value: ModelInfo; index: number } | null>(
    null,
  );
  const [deleteAnchor, setDeleteAnchor] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeDiagnostic, setNoticeDiagnostic] = useState<AiDiagnostic | null>(null);
  const provider = catalog?.providers.find((p) => p.id === providerId) ?? catalog?.providers[0];
  const models = catalog?.models.filter((m) => m.providerId === provider?.id) ?? [];
  const locked = working || ai.busy || ai.testing !== null;
  async function mutation(
    operation: () => Promise<RegistryReply>,
    success: string,
    location: string = editor?.kind === 'provider' ? 'providers' : 'models',
  ) {
    if (locked || mutationLock.current) return false;
    mutationLock.current = true;
    setRemovedProvider(null);
    setRemovedModel(null);
    setNoticeLocation(location);
    setWorking(true);
    setNoticeDiagnostic(null);
    setNotice('');
    try {
      const result = await operation();
      if (!result.ok) {
        setNotice(result.message);
        setNoticeDiagnostic(result.diagnostic ?? messageDiagnostic(result.message));
        await ai.refresh();
        return false;
      }
      ai.setCatalog(result.catalog);
      setNoticeDiagnostic(null);
      setNotice(success);
      return result.catalog;
    } catch {
      setNotice('本地配置操作失败，未清空资料，请重试。');
      setNoticeDiagnostic(messageDiagnostic('本地配置操作失败，未清空资料，请重试。'));
      return false;
    } finally {
      mutationLock.current = false;
      setWorking(false);
    }
  }
  function toggle(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((id) => id !== value) : [...list, value]);
  }
  function prepareDelete(kind: 'providers' | 'models', ids: string[]) {
    if (!catalog || locked) return;
    setDeleteAnchor(ids.length === 1 ? ids[0] : kind);
    const records = kind === 'providers' ? catalog.providers : catalog.models;
    setDeletion({
      kind,
      items: records
        .filter((item) => ids.includes(item.id))
        .map((item) => ({ id: item.id, revision: item.revision })),
    });
    setTest(null);
    setRemovedProvider(null);
    setRemovedModel(null);
    setNotice('');
    setNoticeDiagnostic(null);
  }
  async function deleteConfirmed() {
    if (!deletion || locked || mutationLock.current) return;
    const request = deletion;
    const anchor = deleteAnchor;
    const oldProvider = catalog?.providers.find((p) => p.id === anchor);
    const oldModel = models.find((m) => m.id === anchor);
    setDeletion(null);
    if (
      await mutation(
        () => window.career!.ai.registry.deleteItems(request),
        '已删除所选配置；受影响页面已取消选择，草稿和历史版本保持不变。',
        anchor,
      )
    ) {
      if (oldProvider)
        setRemovedProvider({
          value: oldProvider,
          index: catalog!.providers.findIndex((p) => p.id === anchor),
        });
      if (oldModel)
        setRemovedModel({ value: oldModel, index: models.findIndex((m) => m.id === anchor) });
      setCheckedModels([]);
      setCheckedProviders([]);
    }
  }
  async function runTest() {
    if (!test || locked || testLock.current) return;
    testLock.current = true;
    cancelLock.current = false;
    setCancelling(false);
    const request = test;
    setTest(null);
    ai.setTesting(request);
    setTestResult(null);
    setRemovedProvider(null);
    setRemovedModel(null);
    setNotice('');
    setNoticeDiagnostic(null);
    try {
      const result = await window.career!.ai.registry.testModel(
        request.modelId,
        request.revision,
        request.kind,
      );
      setTestResult({
        modelId: request.modelId,
        message: result.message,
        diagnostic: result.ok
          ? undefined
          : (result.diagnostic ?? messageDiagnostic(result.message)),
      });
    } catch {
      setTestResult({
        modelId: request.modelId,
        message: '测试通信失败，请重新打开设置查看记录。',
        diagnostic: messageDiagnostic('测试通信失败，请重新打开设置查看记录。'),
      });
    } finally {
      await ai.refresh();
      ai.setTesting(null);
      testLock.current = false;
      cancelLock.current = false;
      setCancelling(false);
    }
  }
  if (!catalog)
    return (
      <section className="settings-section">
        <p>正在读取模型目录…</p>
        <button className="secondary" onClick={() => void ai.refresh()}>
          重新读取
        </button>
      </section>
    );
  const displayProviders = [...catalog.providers];
  if (removedProvider)
    displayProviders.splice(
      Math.min(removedProvider.index, displayProviders.length),
      0,
      removedProvider.value,
    );
  const displayModels = [...models];
  if (removedModel && removedModel.value.providerId === provider?.id)
    displayModels.splice(Math.min(removedModel.index, displayModels.length), 0, removedModel.value);
  const view = modelView.providerId === provider?.id ? modelView : { query: '', page: 0 };
  const query = view.query.trim().toLowerCase();
  const filteredModels = displayModels.filter((m) =>
    `${m.name}\n${m.modelId}`.toLowerCase().includes(query),
  );
  const modelPage = listPage(filteredModels, view.page, 25);
  function changeModelView(next: { query: string; page: number }) {
    setModelView({ providerId: provider!.id, ...next });
    setDeletion(null);
    setTest(null);
  }
  const deleteIds = deletion?.items.map((item) => item.id) ?? [];
  const deletedModels = catalog.models.filter((m) =>
    deletion?.kind === 'providers' ? deleteIds.includes(m.providerId) : deleteIds.includes(m.id),
  );
  const affectedPages = Object.entries(catalog.pages)
    .filter(([, setting]) => deletedModels.some((m) => m.id === setting.modelId))
    .map(([page]) => pages[page as keyof typeof pages].name);
  const deleteNames =
    deletion?.kind === 'providers'
      ? catalog.providers.filter((p) => deleteIds.includes(p.id)).map((p) => p.name)
      : deletedModels.map((m) => m.name);
  const testModel = catalog.models.find((m) => m.id === test?.modelId);
  const testProvider = catalog.providers.find((p) => p.id === testModel?.providerId);
  const deletionContent = deletion && !editor && (
    <div className="inline-action-confirm" role="region" aria-label="删除影响确认">
      <h4>确认删除 {deleteNames?.join('、')}</h4>
      <p>
        影响 {deletedModels.length} 个模型；需重新选择模型的标签页：
        {affectedPages.join('、') || '无'}。
      </p>
      <p>
        只删除配置{deletion.kind === 'providers' ? '和对应加密密钥' : ''}
        ，不删除草稿、附件或历史版本。删除后需要重新添加，无法撤销。
      </p>
      <button className="primary small" disabled={locked} onClick={() => void deleteConfirmed()}>
        确认删除所选配置
      </button>
      <button className="text-button" onClick={() => setDeletion(null)}>
        取消
      </button>
    </div>
  );
  const testContent = test && testModel && testProvider && !editor && (
    <div
      ref={testConfirmation}
      tabIndex={-1}
      className="inline-action-confirm"
      role="region"
      aria-label="测试发送确认"
    >
      <h4>
        {test.kind === 'text' ? '模型连通性探针（文本）' : '图片识别测试'} · {testModel.name} /{' '}
        {testProvider.name}
      </h4>
      <p>
        仅测试模型 ID：<strong>{testModel.modelId}</strong>；供应商：{testProvider.name}
      </p>
      <code>{modelConnection(testProvider, testModel).endpoint}</code>
      <p>
        {test.kind === 'text'
          ? '仅发送一句“Reply with only OK.”，检查地址连接、认证及文本流式生成。'
          : '发送程序生成的 32×32 红色 PNG 图片，并询问图片主色；只有正确回答 red 才算此样本通过。'}
      </p>
      {test.kind === 'image' && <div className="red-test-sample" aria-label="红色测试图片示意" />}
      <p>
        {protocolLabel(modelConnection(testProvider, testModel).protocol)}
        {modelConnection(testProvider, testModel).protocol === 'responses'
          ? ' · store: false · 不启用工具与服务端会话'
          : ''}
      </p>
      <p>
        使用该模型的已启用默认参数：
        {JSON.stringify(modelConnection(testProvider, testModel).parameters)}
        。可能产生费用，不发送任何用户求职资料。测试结果不自动更改手动能力标记。
      </p>
      <button className="primary small" disabled={locked} onClick={() => void runTest()}>
        确认发送测试
      </button>
      <button className="text-button" onClick={() => setTest(null)}>
        取消
      </button>
    </div>
  );
  const noticeContent = (
    <>
      <ActionFeedback
        label="配置操作反馈"
        pending={working}
        message={working ? '正在保存本地配置…' : noticeDiagnostic ? '' : notice}
      />
      {notice && noticeDiagnostic && <DiagnosticPanel diagnostic={noticeDiagnostic} />}
    </>
  );
  async function cancelProbe() {
    if (cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    try {
      await window.career!.ai.registry.cancelTest();
    } catch {
      cancelLock.current = false;
      setCancelling(false);
      if (ai.testing && 'modelId' in ai.testing)
        setTestResult({
          modelId: ai.testing.modelId,
          message: '取消请求未确认，请等待当前测试结束或重试。',
          diagnostic: messageDiagnostic('取消请求未确认，请等待当前测试结束或重试。'),
        });
    }
  }
  return (
    <section className="settings-section registry-settings">
      <div className="section-title">
        <Cpu size={19} />
        <h3>供应商与模型</h3>
        <span className="pill">P06 + P07 · 四协议</span>
      </div>
      <p>统一管理连接，各标签页独立选择模型。保存不发请求；测试和生成需要单独确认。</p>
      {editor ? (
        <>
          <button
            className="text-button"
            disabled={locked}
            onClick={() => {
              setEditor(null);
              setNotice('');
            }}
          >
            <ArrowLeft size={14} />
            取消编辑并返回列表
          </button>
          {editor.kind === 'provider' ? (
            <ProviderForm
              key={'provider-' + (editor.value?.id ?? 'new')}
              value={editor.value}
              locked={locked}
              onSave={async (input) => {
                if (
                  await mutation(
                    () => window.career!.ai.registry.saveProvider(input),
                    '供应商已保存，密钥已加密。请在供应商下添加模型。',
                  )
                )
                  setEditor(null);
              }}
            />
          ) : (
            <ModelForm
              key={'model-' + (editor.value?.id ?? 'new')}
              value={editor.value}
              providerId={editor.providerId}
              provider={catalog.providers.find((p) => p.id === editor.providerId)!}
              locked={locked}
              onSave={async (input, probe) => {
                const saved = await mutation(
                  () => window.career!.ai.registry.saveModel(input),
                  '模型已保存。可以回到标签页选择该模型；配置变化后的旧测试记录标为过期。',
                );
                if (!saved) return;
                setEditor(null);
                setProviderId(input.providerId);
                const providerModels = saved.models.filter(
                  (m) => m.providerId === input.providerId,
                );
                const savedIndex = providerModels.findIndex((m) => m.modelId === input.modelId);
                // Reveal the saved row even if a new model lands beyond the current page
                // or an edited name no longer matches the previous search.
                setModelView({
                  providerId: input.providerId,
                  query: '',
                  page: Math.floor(Math.max(0, savedIndex) / 25),
                });
                if (probe) {
                  const model = saved.models.find(
                    (m) => m.providerId === input.providerId && m.modelId === input.modelId,
                  )!;
                  const owner = saved.providers.find((p) => p.id === model.providerId)!;
                  setTest({
                    modelId: model.id,
                    revision: modelConnection(owner, model).revision,
                    kind: 'text',
                  });
                  setDeletion(null);
                }
              }}
            />
          )}
          {noticeContent}
        </>
      ) : (
        <>
          <div className="registry-heading">
            <h4>
              供应商 <span>{catalog.providers.length}</span>
            </h4>
            <button
              className="secondary"
              disabled={locked}
              onClick={() => {
                setEditor({ kind: 'provider', value: null });
                setDeletion(null);
                setTest(null);
              }}
            >
              <Plus size={14} />
              添加供应商
            </button>
          </div>
          <fieldset className="registry-list">
            {displayProviders.length === 0 ? (
              <div className="registry-empty">
                还没有供应商。添加连接后，再添加它提供的模型。
                {noticeLocation === 'providers' && noticeContent}
              </div>
            ) : (
              <>
                <div className="registry-batch">
                  <label>
                    <input
                      disabled={locked}
                      type="checkbox"
                      aria-label="全选供应商"
                      checked={checkedProviders.length === catalog.providers.length}
                      onChange={(e) =>
                        setCheckedProviders(
                          e.target.checked ? catalog.providers.map((p) => p.id) : [],
                        )
                      }
                    />
                    全选
                  </label>
                  <button
                    className="text-button danger"
                    disabled={locked || !checkedProviders.length}
                    onClick={() => prepareDelete('providers', checkedProviders)}
                  >
                    删除所选供应商（{checkedProviders.length}）
                  </button>
                </div>
                {deleteAnchor === 'providers' && deletionContent}
                {noticeLocation === 'providers' && noticeContent}
                {displayProviders.map((p) =>
                  removedProvider?.value.id === p.id ? (
                    <div
                      className="material-removed-feedback"
                      key={p.id}
                      role="region"
                      aria-label={`配置删除结果 ${p.name}`}
                    >
                      <strong>{p.name}</strong>
                      {noticeContent}
                      {!catalog.providers.length && (
                        <p>还没有供应商。添加连接后，再添加它提供的模型。</p>
                      )}
                      <button className="text-button" onClick={() => setRemovedProvider(null)}>
                        收起删除结果
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`provider-row ${p.id === provider?.id ? 'selected' : ''}`}
                      key={p.id}
                    >
                      <input
                        disabled={locked}
                        type="checkbox"
                        aria-label={`选择供应商 ${p.name}`}
                        checked={checkedProviders.includes(p.id)}
                        onChange={() => toggle(p.id, checkedProviders, setCheckedProviders)}
                      />
                      <button
                        disabled={locked}
                        className="provider-summary"
                        aria-label={`管理 ${p.name}`}
                        onClick={() => {
                          setProviderId(p.id);
                          setNotice('');
                          setNoticeDiagnostic(null);
                          setRemovedModel(null);
                          setRemovedProvider(null);
                          setCheckedModels([]);
                          setDeletion(null);
                          setTest(null);
                        }}
                      >
                        <strong>{p.name}</strong>
                        <span>{p.baseUrl}</span>
                        <small>
                          {catalog.models.filter((m) => m.providerId === p.id).length} 个模型 ·{' '}
                          {protocolLabel(p.protocol)}
                        </small>
                      </button>
                      <button
                        disabled={locked}
                        className="icon-button"
                        aria-label={`编辑供应商 ${p.name}`}
                        onClick={() => {
                          setEditor({ kind: 'provider', value: p });
                          setDeletion(null);
                          setTest(null);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        disabled={locked}
                        className="icon-button"
                        aria-label={`删除供应商 ${p.name}`}
                        onClick={() => prepareDelete('providers', [p.id])}
                      >
                        <Trash2 size={15} />
                      </button>
                      {deleteAnchor === p.id && deletionContent}
                      {noticeLocation === p.id && noticeContent}
                    </div>
                  ),
                )}
              </>
            )}
          </fieldset>
          {provider && (
            <>
              <ProviderProbe key={provider.id} provider={provider} locked={locked} />
              <div className="registry-heading">
                <h4>
                  {provider.name} · 模型 <span>{models.length}</span>
                </h4>
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() => {
                    setEditor({ kind: 'model', value: null, providerId: provider.id });
                    setDeletion(null);
                    setTest(null);
                  }}
                >
                  <Plus size={14} />
                  添加模型
                </button>
              </div>
              <ModelDiscovery
                key={provider.id + provider.revision}
                provider={provider}
                locked={locked}
              />
              <fieldset className="registry-list">
                {models.length > 25 || view.query ? (
                  <label className="discovery-search">
                    搜索本供应商模型（名称 / ID）
                    <input
                      aria-label="搜索本供应商模型"
                      value={view.query}
                      disabled={locked}
                      onChange={(e) => changeModelView({ query: e.target.value, page: 0 })}
                    />
                  </label>
                ) : null}
                <ListPager
                  label="已配置模型分页"
                  {...modelPage}
                  disabled={locked}
                  onChange={(page) => changeModelView({ query: view.query, page })}
                />
                {view.query && (
                  <p>搜索命中 {filteredModels.length} 项；全选与批量删除仍针对本供应商全部模型。</p>
                )}
                {!!models.length && (
                  <div className="registry-batch">
                    <label>
                      <input
                        disabled={locked}
                        type="checkbox"
                        aria-label="全选当前模型"
                        checked={models.every((m) => checkedModels.includes(m.id))}
                        onChange={(e) =>
                          setCheckedModels(e.target.checked ? models.map((m) => m.id) : [])
                        }
                      />
                      全选本供应商模型
                    </label>
                    <button
                      className="text-button danger"
                      disabled={locked || !checkedModels.length}
                      onClick={() => prepareDelete('models', checkedModels)}
                    >
                      删除所选模型（{checkedModels.length}）
                    </button>
                  </div>
                )}
                {!models.length && (
                  <div className="registry-empty">
                    此供应商尚无模型。模型 ID 请按服务商提供的信息填写。
                  </div>
                )}
                {deleteAnchor === 'models' && deletionContent}
                {noticeLocation === 'models' && noticeContent}
                {modelPage.items.map((m) =>
                  removedModel?.value.id === m.id ? (
                    <article
                      className="material-removed-feedback"
                      key={m.id}
                      aria-label={`配置删除结果 ${m.name}`}
                    >
                      <strong>{m.name}</strong>
                      {noticeContent}
                      <button className="text-button" onClick={() => setRemovedModel(null)}>
                        收起删除结果
                      </button>
                    </article>
                  ) : (
                    <article className="model-card" key={m.id}>
                      <div className="model-card-heading">
                        <input
                          disabled={locked}
                          type="checkbox"
                          aria-label={`选择模型 ${m.name}`}
                          checked={checkedModels.includes(m.id)}
                          onChange={() => toggle(m.id, checkedModels, setCheckedModels)}
                        />
                        <div>
                          <strong>{m.name}</strong>
                          <code>{m.modelId}</code>
                        </div>
                        <button
                          disabled={locked}
                          className="icon-button"
                          aria-label={`编辑模型 ${m.name}`}
                          onClick={() => {
                            setEditor({ kind: 'model', value: m, providerId: m.providerId });
                            setDeletion(null);
                            setTest(null);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          disabled={locked}
                          className="icon-button"
                          aria-label={`删除模型 ${m.name}`}
                          onClick={() => prepareDelete('models', [m.id])}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="capability-tags">
                        {(Object.entries(m.capabilities) as [keyof Capabilities, string][]).map(
                          ([key, value]) => (
                            <span key={key}>
                              {key === 'images' ? '图片' : key === 'files' ? '文件' : '结构化输出'}{' '}
                              ·{' '}
                              {value === 'supported'
                                ? '手动标记支持'
                                : value === 'unsupported'
                                  ? '手动标记不支持'
                                  : '未知'}
                            </span>
                          ),
                        )}
                      </div>
                      <p>
                        模型连通性探针：只测试本模型的认证、访问与文本流。供应商探针通过不代表本模型可用。
                      </p>
                      <div className="model-test-actions">
                        <button
                          disabled={locked}
                          className="secondary"
                          onClick={() => {
                            setTestResult(null);
                            setTest({
                              modelId: m.id,
                              revision: modelConnection(provider, m).revision,
                              kind: 'text',
                            });
                            setDeletion(null);
                          }}
                        >
                          测试模型连通性 · {m.name}
                        </button>
                        <button
                          disabled={locked}
                          className="secondary"
                          onClick={() => {
                            setTestResult(null);
                            setTest({
                              modelId: m.id,
                              revision: modelConnection(provider, m).revision,
                              kind: 'image',
                            });
                            setDeletion(null);
                          }}
                        >
                          测试图片 · {m.name}
                        </button>
                      </div>
                      {deleteAnchor === m.id && deletionContent}
                      {noticeLocation === m.id && noticeContent}
                      {test?.modelId === m.id && testContent}
                      <ActionFeedback
                        label={`模型测试反馈 ${m.name}`}
                        pending={
                          ai.testing !== null &&
                          'modelId' in ai.testing &&
                          ai.testing.modelId === m.id
                        }
                        message={
                          ai.testing !== null &&
                          'modelId' in ai.testing &&
                          ai.testing.modelId === m.id
                            ? cancelling
                              ? '正在请求停止模型测试…'
                              : `正在测试所选模型 · ${m.name}…`
                            : testResult?.modelId === m.id && !testResult.diagnostic
                              ? testResult.message
                              : ''
                        }
                        cancelling={cancelling}
                        onCancel={() => void cancelProbe()}
                        cancelLabel="取消测试"
                      />
                      {testResult?.modelId === m.id && testResult.diagnostic && (
                        <DiagnosticPanel diagnostic={testResult.diagnostic} />
                      )}
                      <TestRecords
                        records={m.tests}
                        revision={modelConnection(provider, m).revision}
                      />
                    </article>
                  ),
                )}
              </fieldset>
            </>
          )}
        </>
      )}
    </section>
  );
}
function TestRecords({ records, revision }: { records: TestReceipt[]; revision: string }) {
  return (
    <div className="test-records">
      {records.length ? (
        records.map((record) => (
          <div key={record.kind} className={record.ok ? undefined : 'test-record-error'}>
            <p>
              {record.kind === 'text' ? '文本' : '图片'} ·{' '}
              {record.revision !== revision
                ? '已过期（配置已变化）'
                : record.ok
                  ? '已验证通过'
                  : '未通过'}{' '}
              · {new Date(record.checkedAt).toLocaleString('zh-CN')}
              {record.ok && <span>{record.message}</span>}
            </p>
            {!record.ok && (
              <DiagnosticPanel
                diagnostic={record.diagnostic ?? messageDiagnostic(record.message)}
              />
            )}
          </div>
        ))
      ) : (
        <p>尚无实际测试记录。手动标记不代表已验证。</p>
      )}
    </div>
  );
}
function ProviderForm({
  value,
  locked,
  onSave,
}: {
  value: ProviderInfo | null;
  locked: boolean;
  onSave: (input: import('../shared/models').ProviderInput) => Promise<void>;
}) {
  const [name, setName] = useState(value?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>(value?.protocol ?? 'chat-completions');
  let endpoint = '填写地址后预览最终请求地址';
  try {
    if (baseUrl) endpoint = protocolEndpoint(baseUrl, protocol);
  } catch (e) {
    endpoint = (e as Error).message;
  }
  return (
    <fieldset disabled={locked} className="connection-form">
      <h4>{value ? '编辑供应商' : '新供应商'}</h4>
      <div className="connection-grid">
        <label>
          供应商名称
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          默认接口协议
          <select
            aria-label="默认接口协议"
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as Protocol)}
          >
            <option value="chat-completions">OpenAI Chat Completions</option>
            <option value="responses">OpenAI Responses</option>
            <option value="gemini">Gemini 原生协议</option>
            <option value="anthropic">Anthropic Messages</option>
          </select>
        </label>
        <label className="full-field">
          Base URL
          <input
            value={baseUrl}
            maxLength={2048}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
          />
        </label>
        <div className="endpoint-preview full-field">
          <span>最终请求地址</span>
          <code>{endpoint}</code>
        </div>
        <div className="full-field">
          <label htmlFor="provider-api-key">API Key</label>
          <div className="secret-input">
            <input
              id="provider-api-key"
              type={showKey ? 'text' : 'password'}
              value={key}
              maxLength={4096}
              autoComplete="off"
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                value ? '已保存加密密钥；留空保留（包括修改地址时）' : '仅用于这个供应商'
              }
              spellCheck={false}
            />
            <button
              type="button"
              className={`secret-toggle ${showKey ? 'revealed' : ''}`}
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              aria-pressed={showKey}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </div>
      <p className="secure-note">
        <ShieldCheck size={14} />
        密钥由 Windows 本机加密保护，不回填已保存的明文；眼睛按钮仅显示本次输入的
        Key。修改地址时留空可保留原密钥。保存不发送请求；下次确认测试或生成时将使用新地址，请确认它属于可信供应商。
      </p>
      <button
        className="primary"
        onClick={() =>
          void onSave({
            id: value?.id,
            revision: value?.revision,
            name,
            baseUrl,
            apiKey: key,
            protocol,
          })
        }
      >
        保存供应商
      </button>
    </fieldset>
  );
}
function ModelForm({
  value,
  provider,
  providerId,
  locked,
  onSave,
}: {
  value: ModelInfo | null;
  provider: ProviderInfo;
  providerId: string;
  locked: boolean;
  onSave: (input: ModelInput, probe?: boolean) => Promise<void>;
}) {
  const [input, setInput] = useState<ModelInput>(
    value
      ? { ...value, protocol: 'inherit' }
      : {
          providerId,
          modelId: '',
          name: '',
          protocol: 'inherit',
          capabilities: emptyCapabilities(),
          parameterSupport: emptyParameters(),
          parameters: {},
        },
  );
  const [error, setError] = useState('');
  async function save(probe = false) {
    try {
      const valid = validateModel(input);
      setError('');
      await onSave(valid, probe);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const protocol = provider.protocol;
  const native = protocol === 'gemini' || protocol === 'anthropic';
  let modelEndpoint: string;
  try {
    modelEndpoint = protocolEndpoint(provider.baseUrl, protocol, input.modelId || undefined);
  } catch (e) {
    modelEndpoint = (e as Error).message;
  }
  function support(key: keyof ParameterSupport, on: boolean) {
    const parameters = { ...input.parameters };
    if (!on) delete parameters[key];
    setInput({ ...input, parameterSupport: { ...input.parameterSupport, [key]: on }, parameters });
  }
  return (
    <fieldset disabled={locked} className="connection-form">
      <h4>{value ? '编辑模型' : '新模型'}</h4>
      <div className="connection-grid">
        <label>
          模型 ID
          <input
            value={input.modelId}
            maxLength={256}
            onChange={(e) => setInput({ ...input, modelId: e.target.value })}
            spellCheck={false}
          />
        </label>
        <label>
          模型显示名称
          <input
            value={input.name}
            maxLength={100}
            onChange={(e) => setInput({ ...input, name: e.target.value })}
          />
        </label>
      </div>
      <div className="endpoint-preview">
        <span>模型最终请求地址 · {protocolLabel(protocol)}（由供应商决定）</span>
        <code>{modelEndpoint}</code>
      </div>
      <h4>
        能力标记 <small>手动配置，不代表实际验证</small>
      </h4>
      <div className="connection-grid">
        {(['images', 'files', 'structuredOutput'] as const).map((key) => (
          <label key={key} htmlFor={`capability-${key}`}>
            {key === 'images' ? '图片能力' : key === 'files' ? '文件能力' : '结构化输出能力'}
            <select
              id={`capability-${key}`}
              aria-label={
                key === 'images' ? '图片能力' : key === 'files' ? '文件能力' : '结构化输出能力'
              }
              value={input.capabilities[key]}
              onChange={(e) =>
                setInput({
                  ...input,
                  capabilities: { ...input.capabilities, [key]: e.target.value },
                })
              }
            >
              <option value="unknown">未知</option>
              <option value="supported">手动标记支持</option>
              <option value="unsupported">手动标记不支持</option>
            </select>
          </label>
        ))}
      </div>
      <p className="field-hint">
        Gemini 原生协议评分、Chat Completions/Anthropic Messages
        岗位匹配在“结构化输出能力”标记支持时发送 JSON Schema 约束；未知/不支持时仅使用提示词
        JSON。请按供应商实际支持情况设置；不支持该参数的代理可改为未知，不会自动重试收费请求。
      </p>
      <h4>高级参数支持</h4>
      <p>
        仅勾选服务商明确支持的可选参数；未勾选的可选参数不会发送。Messages
        必填输出上限除外。错误设置可能使模型拒绝请求。
      </p>
      <div className="parameter-support">
        {(['temperature', 'maxCompletionTokens', 'reasoningEffort'] as const).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={input.parameterSupport[key]}
              disabled={native && key === 'reasoningEffort' && !input.parameterSupport[key]}
              onChange={(e) => support(key, e.target.checked)}
            />
            {key === 'temperature'
              ? '支持 temperature'
              : key === 'maxCompletionTokens'
                ? protocol === 'responses'
                  ? '支持 max_output_tokens'
                  : protocol === 'gemini'
                    ? '支持 maxOutputTokens'
                    : protocol === 'anthropic'
                      ? '覆盖 max_tokens'
                      : '支持 max_completion_tokens'
                : protocol === 'responses'
                  ? '支持 reasoning.effort'
                  : '支持 reasoning_effort'}
          </label>
        ))}
      </div>
      {native && (
        <p>本批不开放通用推理强度映射；不同模型的思考参数需独立支持，不能直接套用 OpenAI 参数。</p>
      )}
      {protocol === 'anthropic' && (
        <p>Messages 必须发送 max_tokens，未覆盖时使用 4096；温度范围为 0–1。</p>
      )}
      {protocol === 'gemini' && (
        <p>模型 ID 会进入最终路径；API Key 只放请求头，alt=sse 由程序添加，请勿写入 Base URL。</p>
      )}
      <ParameterFields
        protocol={protocol}
        value={input.parameters}
        support={input.parameterSupport}
        onChange={(parameters) => setInput({ ...input, parameters })}
        label="模型默认"
      />
      <p>
        默认值可以留空。各标签页可临时覆盖，实际输出上限由服务商决定。关闭参数支持会清除该模型的相关页面覆盖。
      </p>
      {error && <DiagnosticPanel diagnostic={messageDiagnostic(error)} />}
      <div className="model-probe-hint">
        <h4>模型连通性探针</h4>
        <p>
          使用本模型
          ID、继承的供应商协议和当前参数发送短文本测试，不读取求职资料。先保存配置，再确认接收方与可能费用；不会自动发送。
        </p>
        <button className="secondary" onClick={() => void save(true)}>
          保存并测试模型连通性
        </button>
      </div>
      <button className="primary" onClick={() => void save()}>
        保存模型
      </button>
    </fieldset>
  );
}
