import { MatchHistory } from './MatchPanel';
import type { MatchState } from './useMatch';
import { appVersion } from '../shared/version';
import { ScoreHistory } from './ScorePanel';
import type { ScoreState } from './useScore';
import { VersionHistory } from './ai-controls';
import { RegistrySettings } from './RegistrySettings';
import { useState, useEffect, useRef } from 'react';
import type { PromptPreset } from '../shared/prompts';
import { Modal } from './Modal';
import { Sun, Moon, Monitor, ShieldCheck, Clock3, LockKeyhole } from 'lucide-react';
import type { Theme, WorkspaceDraft, WorkspaceId } from '../shared/contracts';
import { pages } from './content';

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="theme-picker" role="group" aria-label="界面主题">
      {(
        [
          ['light', '浅色', Sun],
          ['dark', '深色', Moon],
          ['system', '跟随系统', Monitor],
        ] as const
      ).map(([value, name, Icon]) => (
        <button
          key={value}
          aria-label={name}
          title={name}
          aria-pressed={theme === value}
          onClick={() => onChange(value)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
export function Settings({
  theme,
  onTheme,
  onClose,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="应用设置" onClose={onClose}>
      <div className="setting-row">
        <div>
          <h3>外观</h3>
          <p>选择适合此刻的阅读方式。</p>
        </div>
        <ThemePicker theme={theme} onChange={onTheme} />
      </div>
      <RegistrySettings />
      <section className="settings-section">
        <div className="section-title">
          <ShieldCheck size={19} />
          <h3>资料与隐私</h3>
        </div>
        <p>
          草稿、设置和历史保存在本机
          SQLite，无应用自建云同步、遥测或自动上传。各标签页互相独立。正文数据库尚未加密，请勿在提示词中粘贴
          API Key。
        </p>
        <p>
          离线可编辑、保存、查看及恢复本地版本。只有确认生成、调整、评分或探针测试才会发送对应请求至所选供应商；远程
          AI 需要联网，本机模型服务须另行配置。供应商可能保留请求日志。
        </p>
        <p>
          英文数字内置 Google Sans（OFL）；中文优先使用本机 MiSans，未安装时使用系统后备字体。
          不联网下载字体，不重新分发 MiSans 文件。第三方许可与清单位于安装目录 resources/licenses。
        </p>
      </section>
      <div className="modal-footer">
        <span>Career Assistant · {appVersion} / 本地资料与简历评分</span>
        <button className="primary small" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}
export function History({
  match,
  id,
  draft,
  onClose,
  onEdit,
  score,
}: {
  match?: MatchState;
  score?: ScoreState;
  id: WorkspaceId;
  draft: WorkspaceDraft;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal title={`${pages[id].name} · 本地记录`} onClose={onClose}>
      <div className="history-current">
        <div className="empty-icon">
          <Clock3 size={24} />
        </div>
        <div>
          <h3>当前草稿</h3>
          <p>
            {draft.updatedAt
              ? `最后保存于 ${new Date(draft.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
              : '还没有已保存的修改'}
          </p>
          <span className="pill">仅属于此标签页</span>
        </div>
      </div>
      {(id === 'resume' || id === 'letter') && <VersionHistory onEdit={onEdit} />}
      {id === 'score' && score && <ScoreHistory score={score} />}
      {id === 'match' && match && <MatchHistory match={match} />}
      <div className="modal-footer">
        <span>其他标签页不会读取这里的资料</span>
        <button className="secondary" onClick={onClose}>
          返回工作区
        </button>
      </div>
    </Modal>
  );
}
export function SystemPrompt({
  page,
  value,
  defaultValue,
  onChange,
}: {
  page: WorkspaceId;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState<PromptPreset | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  useEffect(() => {
    let active = true;
    window.career?.prompts
      .list(page)
      .then((items) => {
        if (active) setPresets(items);
      })
      .catch(() => {
        if (active) setMessage('无法读取本页提示词副本。');
      });
    return () => {
      active = false;
    };
  }, [page]);
  async function savePreset() {
    if (savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    setMessage('');
    try {
      const result = await window.career!.prompts.save(page, name, value);
      if (result.ok) {
        setPresets(result.items);
        setName('');
        setMessage('已另存本页副本；当前提示词与其他页未改变。');
      } else setMessage(result.diagnostic.message);
    } catch {
      setMessage('保存副本失败，现有提示词未改变。');
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }
  return (
    <details className="system-prompt">
      <summary>
        <span>系统提示词</span>
        <span className="detail-caption">Career Advisor · 可自定义</span>
      </summary>
      <label className="sr-only" htmlFor="system-prompt">
        系统提示词正文
      </label>
      <textarea
        id="system-prompt"
        value={value}
        maxLength={100000}
        onChange={(event) => onChange(event.target.value)}
        rows={7}
        spellCheck={false}
      />
      <section className="prompt-presets" aria-label="本页提示词副本">
        <p className="field-hint">
          副本仅保存在本机本页（最多20份），不自动发送。加载或恢复默认不会删除副本，也不能绕过应用输出/证据校验。
        </p>
        <label>
          提示词副本名称
          <input
            aria-label="提示词副本名称"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={saving || !name.trim() || !value.trim()}
          onClick={() => void savePreset()}
        >
          另存为本页提示词
        </button>
        <label>
          已保存提示词
          <select
            aria-label="已保存提示词"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPending(null);
            }}
          >
            <option value="">选择本页副本</option>
            {presets.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={!selected || saving}
          onClick={() => setPending(presets.find((p) => p.id === selected) ?? null)}
        >
          加载所选提示词
        </button>
        {pending && (
          <div role="alertdialog" aria-label="确认加载提示词">
            <p>
              用“{pending.name}
              ”替换当前提示词？若需保留当前手改内容，请先取消并另存副本。正文和历史不会改变。
            </p>
            <button
              onClick={() => {
                onChange(pending.text);
                setPending(null);
                setConfirmReset(false);
                setMessage('已加载本页副本。');
              }}
            >
              确认加载提示词
            </button>
            <button onClick={() => setPending(null)}>取消加载</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      {confirmReset ? (
        <div className="inline-confirm">
          <span>替换当前自定义提示词？</span>
          <button
            className="text-button"
            onClick={() => {
              onChange(defaultValue);
              setConfirmReset(false);
            }}
          >
            确认恢复默认
          </button>
          <button className="text-button" onClick={() => setConfirmReset(false)}>
            取消
          </button>
        </div>
      ) : (
        <button
          className="text-button"
          disabled={value === defaultValue}
          onClick={() => setConfirmReset(true)}
        >
          恢复默认提示词
        </button>
      )}
    </details>
  );
}
