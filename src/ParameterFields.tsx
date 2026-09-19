import { AiError, type Protocol } from '../shared/ai';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import { DiagnosticPanel } from './DiagnosticPanel';
import { useState } from 'react';
import type { Parameters, ParameterSupport } from '../shared/models';
import { validateParameters } from '../shared/models';
export function ParameterFields({
  value,
  support,
  onChange,
  label = '参数',
  protocol = 'chat-completions',
}: {
  value: Parameters;
  support: ParameterSupport;
  onChange: (value: Parameters) => void;
  label?: string;
  protocol?: Protocol;
}) {
  function set(key: keyof Parameters, raw: string) {
    const next = { ...value };
    if (raw === '') delete next[key];
    else if (key === 'reasoningEffort') next.reasoningEffort = raw as Parameters['reasoningEffort'];
    else next[key] = Number(raw);
    onChange(next);
  }
  return (
    <div className="parameter-grid">
      {support.temperature && (
        <label>
          温度 · {label}
          <input
            aria-label={`温度 · ${label}`}
            type="number"
            min="0"
            max={protocol === 'anthropic' ? 1 : 2}
            step="0.1"
            placeholder="不指定 / 继承"
            value={value.temperature ?? ''}
            onChange={(e) => set('temperature', e.target.value)}
          />
        </label>
      )}
      {support.maxCompletionTokens && (
        <label>
          输出上限 · {label}
          <input
            aria-label={`输出上限 · ${label}`}
            type="number"
            min={protocol === 'responses' ? 16 : 1}
            max="1000000"
            step="1"
            placeholder="不指定 / 继承"
            value={value.maxCompletionTokens ?? ''}
            onChange={(e) => set('maxCompletionTokens', e.target.value)}
          />
        </label>
      )}
      {support.reasoningEffort && protocol !== 'gemini' && protocol !== 'anthropic' && (
        <label>
          推理强度 · {label}
          <select
            aria-label={`推理强度 · ${label}`}
            value={value.reasoningEffort ?? ''}
            onChange={(e) => set('reasoningEffort', e.target.value)}
          >
            <option value="">不指定 / 继承</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      )}
      {!Object.values(support).some(Boolean) && (
        <p>
          {protocol === 'anthropic'
            ? '未启用可选参数；Messages 仍发送必填 max_tokens=4096。'
            : '尚未启用可选参数；按模型服务的默认行为请求。'}
        </p>
      )}
    </div>
  );
}
function parameterSaveDiagnostic(error: unknown): AiDiagnostic {
  // Only the app-sanitized diagnostic contract is displayable, never arbitrary error text.
  const diagnostic =
    error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : undefined;
  if (diagnostic && typeof diagnostic === 'object') {
    const value = diagnostic as Partial<AiDiagnostic>;
    if (
      typeof value.code === 'string' &&
      typeof value.message === 'string' &&
      Array.isArray(value.possibleCauses) &&
      value.possibleCauses.every((item) => typeof item === 'string') &&
      Array.isArray(value.solutions) &&
      value.solutions.every((item) => typeof item === 'string') &&
      (value.httpStatus === undefined ||
        (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599))
    )
      return value as AiDiagnostic;
  }
  return messageDiagnostic('本地操作失败：本页参数未能保存，请保留当前设置并重试。');
}
export function ParameterEditor({
  initial,
  support,
  protocol,
  onSave,
  onCancel,
}: {
  initial: Parameters;
  protocol?: Protocol;
  support: ParameterSupport;
  onSave: (params: Parameters) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setDiagnostic(null);
    let parameters: Parameters;
    try {
      parameters = validateParameters(value);
    } catch (error) {
      // Validation messages originate locally and do not include external response text.
      setDiagnostic(
        messageDiagnostic(
          error instanceof AiError ? error.message : '参数设置无效，请检查后重试。',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(parameters);
    } catch (error) {
      setDiagnostic(parameterSaveDiagnostic(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-parameters">
      <fieldset disabled={busy}>
        <ParameterFields
          protocol={protocol}
          value={value}
          support={support}
          onChange={setValue}
          label="本页覆盖"
        />
        <p>空白继承模型默认值；只影响此标签页。只有声明支持的参数才会发送。</p>
        <button className="primary small" onClick={() => void save()}>
          保存本页参数
        </button>
        <button className="text-button" onClick={onCancel}>
          取消
        </button>
      </fieldset>
      {diagnostic && <DiagnosticPanel diagnostic={diagnostic} />}
    </div>
  );
}
