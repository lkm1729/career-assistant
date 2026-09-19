import { ActionFeedback } from './ActionFeedback';
import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { providerProbeEndpoint, type ProviderInfo } from '../shared/models';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import { protocolLabel } from '../shared/ai';
import { useAi } from './useAi';
import { DiagnosticPanel } from './DiagnosticPanel';
export function ProviderProbe({ provider, locked }: { provider: ProviderInfo; locked: boolean }) {
  const ai = useAi();
  const [confirmation, setConfirmation] = useState<ProviderInfo | null>(null);
  const [error, setError] = useState<AiDiagnostic | null>(null);
  useEffect(() => {
    setError(null);
    setMessage('');
    setConfirmation(null);
  }, [provider.revision]);
  const inFlight = useRef(false);
  const cancellingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const running = ai.testing?.kind === 'provider' && ai.testing.providerId === provider.id;
  async function run() {
    if (!confirmation || locked || inFlight.current) return;
    const target = confirmation;
    inFlight.current = true;
    setConfirmation(null);
    setError(null);
    setMessage('');
    setCancelling(false);
    cancellingRef.current = false;
    ai.setTesting({ providerId: target.id, revision: target.revision, kind: 'provider' });
    try {
      const result = await window.career!.ai.registry.testProvider(target.id, target.revision);
      setMessage(result.message);
      if (!result.ok) setError(result.diagnostic ?? messageDiagnostic(result.message));
    } catch {
      setError(messageDiagnostic('供应商探针通信失败，请重新打开设置查看记录。'));
    } finally {
      await ai.refresh();
      ai.setTesting(null);
      inFlight.current = false;
      cancellingRef.current = false;
      setCancelling(false);
    }
  }
  return (
    <section className="provider-probe" aria-label="供应商连通性">
      <button
        className="secondary"
        disabled={locked}
        onClick={() => {
          setConfirmation(provider);
          setError(null);
          setMessage('');
        }}
      >
        <Radio size={16} />
        测试供应商连通性 · {provider.name}
      </button>
      {confirmation && (
        <div className="inline-action-confirm" aria-label="供应商探针确认">
          <h4>确认测试供应商 · {confirmation.name}</h4>
          <code>{providerProbeEndpoint(confirmation.baseUrl, confirmation.protocol)}</code>
          <p>
            {protocolLabel(confirmation.protocol)} · 使用已保存 Key
            请求模型列表（GET），不发送求职资料，也不发起模型生成。供应商可能记录访问日志。
          </p>
          <p>
            此探针只检查模型列表接口。代理可能不提供列表；失败不一定表示生成不可用，可继续单独测试模型。
          </p>
          <button className="primary" disabled={locked} onClick={() => void run()}>
            确认测试供应商
          </button>
          <button className="text-button" disabled={locked} onClick={() => setConfirmation(null)}>
            取消
          </button>
        </div>
      )}
      <ActionFeedback
        label="供应商测试反馈"
        pending={running}
        message={
          running
            ? cancelling
              ? '正在请求停止供应商测试…'
              : '正在探测供应商地址与认证…'
            : error
              ? ''
              : message
        }
        cancelling={cancelling}
        cancelLabel="取消测试"
        onCancel={() => {
          if (cancellingRef.current) return;
          cancellingRef.current = true;
          setCancelling(true);
          void window.career!.ai.registry.cancelTest().catch(() => {
            cancellingRef.current = false;
            setCancelling(false);
            setError(messageDiagnostic('取消请求未确认，请等待供应商测试结束或重试。'));
          });
        }}
      />
      {provider.test && !running && (
        <div className="provider-test-result">
          <p>
            {provider.test.revision !== provider.revision
              ? '已过期（供应商配置已变化）'
              : provider.test.ok
                ? '供应商探针已通过'
                : '供应商探针未通过'}{' '}
            · {new Date(provider.test.checkedAt).toLocaleString('zh-CN')}
          </p>
          {provider.test.ok ? (
            <p>{provider.test.message}</p>
          ) : (
            !error && (
              <DiagnosticPanel
                diagnostic={provider.test.diagnostic ?? messageDiagnostic(provider.test.message)}
              />
            )
          )}
        </div>
      )}
      {error && <DiagnosticPanel diagnostic={error} />}
    </section>
  );
}
