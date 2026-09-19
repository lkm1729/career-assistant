import { useEffect, useRef, useState } from 'react';
import { useAi } from './useAi';
import { ActionFeedback } from './ActionFeedback';
import { DiagnosticPanel } from './DiagnosticPanel';
import { providerProbeEndpoint, type ProviderInfo } from '../shared/models';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import type { DiscoveryResult } from '../shared/discovery';
export function ModelDiscovery({ provider, locked }: { provider: ProviderInfo; locked: boolean }) {
  const ai = useAi();
  const [opened, setOpened] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);
  const [operation, setOperation] = useState<'fetch' | 'import'>('fetch');
  const [confirmImport, setConfirmImport] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const lock = useRef(false);
  const fetching = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (fetching.current) void window.career!.ai.registry.cancelTest().catch(() => {});
    };
  }, []);
  const existing = new Set(
    ai.catalog?.models.filter((m) => m.providerId === provider.id).map((m) => m.modelId),
  );
  const filtered =
    result?.models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase())) ?? [];
  const candidates = filtered.filter((m) => !existing.has(m.id));
  const ids = selected.filter((id) => !existing.has(id));
  const disabled = locked || working;
  async function fetchList(next = false) {
    if (disabled || lock.current) return;
    lock.current = true;
    fetching.current = true;
    setOperation('fetch');
    setWorking(true);
    setCancelling(false);
    setDiagnostic(null);
    setMessage('正在获取模型列表…');
    setConfirmImport(false);
    ai.setTesting({ providerId: provider.id, revision: provider.revision, kind: 'discovery' });
    if (!next) {
      setResult(null);
      setSelected([]);
    }
    try {
      const reply = await window.career!.ai.registry.discoverModels(
        provider.id,
        provider.revision,
        next ? result?.session : undefined,
      );
      if (!mounted.current) return;
      if (reply.ok) {
        setResult(reply.result);
        setMessage(
          reply.result.models.length
            ? `已获取 ${reply.result.models.length} 个不重复模型（${reply.result.pages} 页）。列表不代表生成权限或能力；尚未导入。`
            : '接口返回空列表；可手动添加模型，空列表不代表无法生成。',
        );
      } else {
        setDiagnostic(reply.diagnostic);
        setMessage(reply.message);
      }
    } catch {
      if (mounted.current) {
        const d = messageDiagnostic('本地模型列表操作失败，请重试。');
        setDiagnostic(d);
        setMessage(d.message);
      }
    } finally {
      lock.current = false;
      fetching.current = false;
      ai.setTesting(null);
      if (mounted.current) {
        setWorking(false);
        setCancelling(false);
      }
    }
  }
  async function cancel() {
    if (!fetching.current || cancelling) return;
    setCancelling(true);
    try {
      await window.career!.ai.registry.cancelTest();
    } catch {
      setCancelling(false);
      setMessage('取消请求未确认，请等待当前请求结束。');
    }
  }
  async function importSelected() {
    if (disabled || lock.current || !result || !ids.length) return;
    lock.current = true;
    setWorking(true);
    setDiagnostic(null);
    setMessage('正在导入所选模型…');
    setOperation('import');
    ai.setExtraBusy(true);
    try {
      const reply = await window.career!.ai.registry.importModels(result.session, ids);
      if (!mounted.current) return;
      if (reply.ok) {
        ai.setCatalog(reply.catalog);
        setSelected([]);
        setConfirmImport(false);
        setMessage('所选模型已导入，重复 ID 已跳过；未切换当前模型，未启用任何能力或发起探针。');
      } else {
        setDiagnostic(reply.diagnostic ?? messageDiagnostic(reply.message));
        setMessage(reply.message);
      }
    } catch {
      if (mounted.current) {
        const d = messageDiagnostic('本地模型导入失败，已有配置保持不变。');
        setDiagnostic(d);
        setMessage(d.message);
      }
    } finally {
      lock.current = false;
      ai.setExtraBusy(false);
      if (mounted.current) setWorking(false);
    }
  }
  const feedback = (
    <>
      <ActionFeedback
        label="模型列表操作结果"
        pending={working}
        message={message}
        error={!!diagnostic}
        onCancel={fetching.current ? () => void cancel() : undefined}
        cancelling={cancelling}
        cancelLabel="取消获取模型列表"
      />
      {diagnostic && <DiagnosticPanel diagnostic={diagnostic} />}
    </>
  );
  return (
    <section className="model-discovery" aria-label="获取模型列表">
      <button className="secondary" disabled={disabled} onClick={() => setOpened(!opened)}>
        {opened ? '收起模型列表' : '获取模型列表'}
      </button>
      {opened && (
        <>
          <p>
            仅使用此供应商保存的密钥发送 GET
            列表请求，不发送简历、提示词或工作台资料。供应商可能记录访问；列表不代表生成权限或能力，不会自动运行收费探针。
          </p>
          <p className="discovery-endpoint">
            请求地址：<code>{providerProbeEndpoint(provider.baseUrl, provider.protocol)}</code>
          </p>
          <p>
            每页等待最多 30 秒；最多读取 20 页 / 5000 项。分页仅在点击时读取。手动添加模型仍可使用。
          </p>
          <button className="secondary" disabled={disabled} onClick={() => void fetchList()}>
            确认获取模型列表
          </button>
          {operation === 'fetch' && feedback}
          {result && (
            <>
              <label className="discovery-search">
                搜索模型 ID
                <input
                  aria-label="搜索模型 ID"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setConfirmImport(false);
                  }}
                />
              </label>
              <p>
                已获取 {result.models.length} 个 · 搜索命中 {filtered.length} 个 · 已选择{' '}
                {ids.length} 个（单次最多 500 个）
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label="全选搜索结果"
                  disabled={disabled || !candidates.length || candidates.length > 500}
                  checked={!!candidates.length && candidates.every((m) => ids.includes(m.id))}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? candidates.map((m) => m.id)
                        : selected.filter((id) => !candidates.some((m) => m.id === id)),
                    );
                    setConfirmImport(false);
                  }}
                />
                全选搜索结果（最多 500 个；会替换当前选择）
              </label>
              <div className="discovery-models" role="group" aria-label="可导入模型">
                {filtered.map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      aria-label={`导入模型 ${m.id}`}
                      disabled={
                        disabled || existing.has(m.id) || (ids.length >= 500 && !ids.includes(m.id))
                      }
                      checked={ids.includes(m.id)}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((id) => id !== m.id),
                        );
                        setConfirmImport(false);
                      }}
                    />
                    <span>
                      {m.id}
                      {existing.has(m.id) ? '（已存在）' : ''}
                    </span>
                  </label>
                ))}
              </div>
              {result.hasMore && (
                <button
                  className="secondary"
                  disabled={disabled || result.pages >= 20}
                  onClick={() => void fetchList(true)}
                >
                  获取下一页
                </button>
              )}
              {result.hasMore && result.pages >= 20 && (
                <p>已达 20 页上限，可导入已获取项或手动添加。</p>
              )}
              <button
                className="secondary"
                disabled={disabled || !ids.length}
                onClick={() => setConfirmImport(true)}
              >
                导入所选模型（{ids.length}）
              </button>
              {operation === 'import' && feedback}
              {confirmImport && (
                <div role="group" aria-label="确认导入模型">
                  <p>
                    将向 {provider.name} 添加 {ids.length}{' '}
                    个模型；不覆盖现有配置、不改变页面选择。能力保持未知，高级参数支持默认关闭。
                  </p>
                  <button
                    className="primary"
                    disabled={disabled || !ids.length}
                    onClick={() => void importSelected()}
                  >
                    确认导入
                  </button>
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => setConfirmImport(false)}
                  >
                    取消导入
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
