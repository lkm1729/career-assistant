import { useEffect, useRef, useState } from 'react';
import { Eraser, Undo2 } from 'lucide-react';
import type { WorkspaceId } from '../shared/contracts';
import type { WorkbenchSnapshot } from '../shared/workbench';
import { pages } from './content';
import { Modal } from './Modal';
import { ActionFeedback } from './ActionFeedback';

export function ClearResultControl({
  page,
  resultKey,
  hasResult,
  disabled,
  flush,
  onBusy,
  onChanged,
  onHistory,
}: {
  page: WorkspaceId;
  resultKey: string;
  hasResult: boolean;
  disabled: boolean;
  flush: () => Promise<boolean>;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<void>;
  onHistory: () => void;
}) {
  const [canUndo, setCanUndo] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<WorkbenchSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const writing = page === 'resume' || page === 'letter';
  useEffect(() => {
    let active = true;
    void window
      .career!.workbench.inspect(page)
      .then((s) => {
        if (active) setCanUndo(s.canUndo);
      })
      .catch(() => {
        if (active) {
          setMessage('无法读取恢复状态；请重试或从本页记录恢复。');
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [page, resultKey]);
  async function act(action: 'prepare' | 'clear' | 'undo') {
    if (lock.current || disabled) return;
    lock.current = true;
    setPending(true);
    onBusy(true);
    setMessage('');
    setError(false);
    let applied = false;
    try {
      if (!(await flush())) throw Error('草稿尚未保存，请先重试保存；未清空任何成果。');
      if (action === 'prepare') {
        const snapshot = await window.career!.workbench.inspect(page);
        if (!snapshot.hasResult) throw Error('当前没有可清空的成果。');
        setConfirmation(snapshot);
      } else {
        const snapshot =
          action === 'clear' ? confirmation : await window.career!.workbench.inspect(page);
        if (!snapshot) throw Error('请重新确认清空范围。');
        const reply = await window.career!.workbench[action](snapshot);
        setConfirmation(null);
        if (!reply.ok) throw Error(reply.diagnostic.message);
        applied = true;
        setCanUndo(reply.value.canUndo);
        await onChanged();
        setMessage(
          action === 'clear'
            ? '当前成果已清空，输入资料与历史仍保留；可恢复刚清空的结果。'
            : '已恢复刚清空的结果，当前输入资料保持不变。',
        );
      }
    } catch (e) {
      setConfirmation(null);
      setError(true);
      setMessage(
        applied
          ? '本地操作已完成，但界面刷新失败。请重新打开应用或本页记录确认，勿重复操作。'
          : e instanceof Error
            ? e.message
            : '本地操作失败，请重试；历史未删除。',
      );
    } finally {
      lock.current = false;
      setPending(false);
      onBusy(false);
    }
  }
  return (
    <section className="clear-result-control" aria-label={`${pages[page].name}成果管理`}>
      <div className="clear-result-actions">
        <button
          className="secondary"
          disabled={disabled || pending || !hasResult}
          onClick={() => void act('prepare')}
        >
          <Eraser size={16} />
          清空当前结果
        </button>
        {canUndo && !hasResult && (
          <button
            className="secondary"
            disabled={disabled || pending}
            onClick={() => void act('undo')}
          >
            <Undo2 size={16} />
            恢复刚清空的结果
          </button>
        )}
        <button className="text-button" onClick={onHistory} disabled={pending}>
          查看保留的历史
        </button>
        <span>仅清空本页成果，不删除输入资料或历史</span>
      </div>
      <ActionFeedback
        label="清空成果操作反馈"
        pending={pending}
        error={error}
        message={pending ? '正在核对并保存本页成果状态…' : message}
      />
      {confirmation && (
        <Modal
          title={`${pages[page].name} · 清空当前结果`}
          onClose={() => {
            if (!pending) setConfirmation(null);
          }}
        >
          <p>仅清空「{pages[page].name}」当前工作台上的成果。</p>
          <ul>
            <li>
              {writing
                ? '生成正文及其对应建议、说明将从当前工作台移除。手动编辑的正文也会清空，清空前会保存草稿备份。'
                : '只移除当前展示的评估报告，不删除任何评估历史，也不清空用于评估的简历文字。'}
            </li>
            <li>输入要求、修改要求、文件、图片、网页资料、模型设置及其他页面均保留。</li>
            <li>可使用“恢复刚清空的结果”撤销，或在本页记录中恢复。此操作不是永久删除历史。</li>
            <li>清空状态会保存，重启后不会自动重新显示旧成果。</li>
          </ul>
          <div className="modal-footer">
            <button className="secondary" disabled={pending} onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button
              className="danger"
              disabled={pending || disabled}
              onClick={() => void act('clear')}
            >
              确认清空当前结果
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
