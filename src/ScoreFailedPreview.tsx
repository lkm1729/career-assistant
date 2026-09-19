import { useEffect, useRef, useState } from 'react';
import type { ScoreFailurePreview } from '../shared/scoring';
import { Modal } from './Modal';

/** Raw output lives only in this opt-in view, never in the diagnostic/error component. */
export function ScoreFailedPreview({ runId }: { runId: string }) {
  const ticket = useRef(0);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<ScoreFailurePreview | null>(null);
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [used, setUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(
    () => () => {
      ticket.current++;
      void window.career!.score.discardFailedPreview(runId).catch(() => {});
    },
    [runId],
  );
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        ticket.current++;
        setPreview(null);
        setText('');
        setReviewed(false);
        setBusy(false);
        setNotice('临时评分响应已到期并清除。');
      },
      Math.max(0, preview.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);
  function clear() {
    ticket.current++;
    setPreview(null);
    setText('');
    setReviewed(false);
    setConfirm(false);
    setUsed(true);
    setBusy(false);
    setNotice('临时评分响应已清除；若已手动复制，请自行管理系统剪贴板。');
    void window.career!.score.discardFailedPreview(runId).catch(() => {});
  }
  async function view() {
    if (busy) return;
    const active = ++ticket.current;
    setBusy(true);
    try {
      const value = await window.career!.score.takeFailedPreview(runId);
      if (active !== ticket.current) return;
      setConfirm(false);
      setUsed(true);
      if (!value || value.expiresAt <= Date.now()) {
        setNotice('临时评分响应已清除或到期；不会自动重发请求。');
        return;
      }
      setPreview(value);
      setText(value.text);
      setReviewed(false);
    } catch {
      if (active === ticket.current) {
        setConfirm(false);
        setNotice('读取临时响应失败；未重发模型请求。');
      }
    } finally {
      if (active === ticket.current) setBusy(false);
    }
  }
  return (
    <section className="material-warning" aria-label="评分失败响应诊断">
      <p>
        本次JSON或维度校验失败响应已按你的选择临时留在本机；未经校验，不是评分结果，可能含个人资料。5分钟后失效。
      </p>
      {!used && (
        <>
          <button className="secondary" onClick={() => setConfirm(true)}>
            查看本次评分失败响应（仅本机）
          </button>
          <button className="secondary" onClick={clear}>
            丢弃评分临时响应
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {confirm && (
        <Modal title="确认查看评分失败响应" onClose={clear}>
          <p>
            只读取本机临时内存，不联网、不重试、不保存到历史。已遮蔽已知本次API
            Key，但这不是完整脱敏；响应可能包含简历、姓名、联系方式等个人信息。
          </p>
          <p>
            下一步按纯文本显示，可手动修改敏感内容后复制。为定位JSON问题，请保留引号、反斜杠、逗号和换行。
          </p>
          <div className="modal-footer">
            <button onClick={clear}>取消并清除</button>
            <button className="primary" disabled={busy} onClick={() => void view()}>
              我了解，仅在本机查看评分响应
            </button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal title="评分失败响应 · 本机临时诊断" onClose={clear}>
          <p>
            下方是本次返回的未通过校验的正文，不执行HTML或Markdown，也不会自动修复、重新评分或发送。
          </p>
          {preview.truncated && (
            <p role="alert">
              响应超过700000字符，仅保留开头部分；这不是完整响应，截取本身可能造成不完整JSON。
            </p>
          )}
          <p>
            已知本次API Key已遮蔽，但不是完整脱敏。请先处理个人信息再分享；不要把API
            Key或未经检查的完整简历发给他人。
          </p>
          <textarea
            aria-label="评分失败响应文本（可手动脱敏）"
            value={text}
            rows={16}
            spellCheck={false}
            style={{ width: '100%', fontFamily: 'monospace' }}
            onChange={(event) => {
              setText(event.target.value);
              setReviewed(false);
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            我已检查当前文本中的个人信息，同意复制到系统剪贴板
          </label>
          <p className="field-hint">
            仅应用内副本在到期、关闭、离开评分页或下次评分时清除；手动复制的系统剪贴板不会自动清除。应用不主动落盘，不承诺操作系统换页/崩溃转储无痕。
          </p>
          <div className="modal-footer">
            <button onClick={clear}>关闭并清除评分响应</button>
            <button
              className="secondary"
              disabled={!reviewed || !text || busy}
              onClick={async () => {
                if (Date.now() >= preview.expiresAt) {
                  clear();
                  return;
                }
                const active = ticket.current;
                setBusy(true);
                try {
                  await navigator.clipboard.writeText(text);
                  if (active === ticket.current)
                    setNotice('已按你的操作复制当前文本；系统剪贴板由你管理。');
                } catch {
                  if (active === ticket.current) setNotice('复制失败，可手动选择已脱敏文本。');
                } finally {
                  if (active === ticket.current) setBusy(false);
                }
              }}
            >
              复制已检查的当前文本
            </button>
          </div>
          {notice && <p role="status">{notice}</p>}
        </Modal>
      )}
    </section>
  );
}
