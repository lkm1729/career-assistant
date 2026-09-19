import { AiError, protocolLabel } from '../shared/ai';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
import { DiagnosticPanel } from './DiagnosticPanel';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useAi } from './useAi';
import type { WorkspaceId } from '../shared/contracts';
import { modelConnection, type Parameters } from '../shared/models';
import { ParameterEditor } from './ParameterFields';
export function ModelPicker({ page, onSettings }: { page: WorkspaceId; onSettings: () => void }) {
  const ai = useAi();
  const [saving, setSaving] = useState(false);
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null);
  const catalog = ai.catalog;
  const selection = catalog?.pages[page];
  async function select(id: string) {
    if (!window.career || !selection) return;
    setSaving(true);
    setDiagnostic(null);
    try {
      const result = await window.career.ai.registry.selectModel(
        page,
        id || null,
        {},
        selection.revision,
      );
      if (result.ok) ai.setCatalog(result.catalog);
      else {
        setDiagnostic(result.diagnostic ?? messageDiagnostic(result.message));
        await ai.refresh();
      }
    } catch {
      setDiagnostic(messageDiagnostic('模型选择保存通信失败，请重试。'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page-model-picker">
      <select
        aria-label="本页模型"
        value={selection?.modelId ?? ''}
        disabled={saving || !catalog}
        onChange={(e) => void select(e.target.value)}
      >
        <option value="">请选择模型</option>
        {catalog?.providers.map((p) => (
          <optgroup label={p.name} key={p.id}>
            {catalog.models
              .filter((m) => m.providerId === p.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} / {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <button
        className="icon-button"
        onClick={onSettings}
        aria-label="管理供应商与模型"
        title="管理供应商与模型"
      >
        <Settings2 size={16} />
      </button>
      {diagnostic && <DiagnosticPanel diagnostic={diagnostic} />}
    </div>
  );
}
export function PageParameters({ page }: { page: WorkspaceId }) {
  const ai = useAi();
  const [editing, setEditing] = useState(false);
  const catalog = ai.catalog;
  const settings = catalog?.pages[page];
  const model = catalog?.models.find((m) => m.id === settings?.modelId);
  if (!model || !settings) return null;
  const provider = catalog!.providers.find((p) => p.id === model.providerId)!;
  const connection = modelConnection(provider, model, settings.overrides);
  const effective = connection.parameters ?? {};
  async function save(params: Parameters) {
    const result = await window.career!.ai.registry.selectModel(
      page,
      model!.id,
      params,
      settings!.revision,
    );
    if (!result.ok) {
      await ai.refresh();
      throw new AiError(result.message, result.diagnostic ?? messageDiagnostic(result.message));
    }
    ai.setCatalog(result.catalog);
    setEditing(false);
  }
  return (
    <div className="page-parameter-summary">
      <div>
        <span>本页参数 · {protocolLabel(connection.protocol)}</span>
        <code>
          {Object.keys(effective).length
            ? JSON.stringify(effective)
            : '服务默认值 · 不发送可选参数'}
        </code>
        <button className="text-button" onClick={() => setEditing(!editing)}>
          {editing ? '收起' : '调整'}
        </button>
      </div>
      {editing && (
        <ParameterEditor
          key={model.id + settings.revision}
          initial={settings.overrides}
          protocol={connection.protocol}
          support={model.parameterSupport}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
