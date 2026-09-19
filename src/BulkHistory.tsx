import { Fragment, useRef, useState, type ReactNode } from 'react';
import { ListPager, listPage } from './ListPager';

/** Selection is independent from viewing; confirmations freeze the exact selected identities. */
export function BulkHistory<T>({
  items,
  identity,
  label,
  disabled,
  revision = '',
  impact,
  remove,
  render,
  recover,
}: {
  items: readonly T[];
  identity: (item: T) => string;
  label: string;
  disabled: boolean;
  revision?: string;
  impact: string;
  remove: (items: T[], revision: string) => Promise<boolean>;
  render: (item: T) => ReactNode;
  recover?: (items: T[]) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [requestedPage, setPage] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    ids: string[];
    stamp: string;
    revision: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const ids = items.map(identity);
  const validIds = new Set(ids);
  const selected = checked.filter((id) => validIds.has(id));
  const selectedSet = new Set(selected);
  const stamp = JSON.stringify([revision, ids]);
  const ready = confirmation?.stamp === stamp ? confirmation : null;
  const blocked = disabled || pending;
  const page = listPage(items, requestedPage, 20);
  function select(next: string[]) {
    setChecked(next);
    setConfirmation(null);
    setMessage('');
  }
  async function act(kind: 'delete' | 'recover') {
    if (blocked || lock.current || (kind === 'delete' && !ready)) return;
    const targets = new Set(kind === 'delete' ? ready!.ids : selected);
    const chosen = items.filter((item) => targets.has(identity(item)));
    if (!chosen.length) return;
    lock.current = true;
    setPending(true);
    setMessage('');
    try {
      const ok = kind === 'delete' ? await remove(chosen, ready!.revision) : await recover!(chosen);
      setConfirmation(null);
      if (ok) {
        setChecked([]);
        setMessage(
          kind === 'delete'
            ? `已永久删除 ${chosen.length} 条${label}。`
            : `已恢复 ${chosen.length} 条${label}。`,
        );
      } else setMessage('操作未确认完成，请核对提示并刷新列表后重新选择。');
    } catch {
      setConfirmation(null);
      setMessage('通信或刷新失败，请重新打开本页记录核对结果；不要直接重复删除。');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <div className="history-batch" role="group" aria-label={`批量管理${label}`}>
        <label>
          <input
            type="checkbox"
            aria-label={label === '回收站版本' ? '全选可操作版本' : `全选${label}`}
            checked={ids.length > 0 && selected.length === ids.length}
            ref={(el) => {
              if (el) el.indeterminate = selected.length > 0 && selected.length < ids.length;
            }}
            disabled={blocked || !ids.length}
            onChange={(e) => select(e.target.checked ? ids : [])}
          />
          全选本页全部{label}（共 {ids.length} 条，含全部分页）
        </label>
        <span>
          已选 {selected.length} / {ids.length} 条
        </span>
        <button
          className="secondary"
          disabled={blocked || !selected.length}
          onClick={() => select([])}
        >
          取消选择
        </button>
        {recover && (
          <button
            className="secondary"
            disabled={blocked || !selected.length}
            onClick={() => void act('recover')}
          >
            恢复所选版本 ({selected.length})
          </button>
        )}
        <button
          className="danger"
          disabled={blocked || !selected.length}
          onClick={() => {
            setConfirmation({ ids: [...selected], stamp, revision });
            setMessage('');
          }}
        >
          永久删除所选{label} ({selected.length})
        </button>
      </div>
      {confirmation && !ready && <p role="status">列表或当前显示已变化，请重新选择并确认删除。</p>}
      {ready && (
        <section className="inline-action-confirm" aria-label={`确认删除${label}`}>
          <h4>
            确认永久删除 {ready.ids.length} 条{label}？
          </h4>
          <p>
            范围：当前标签页的{label}，含跨分页选中项。删除后无法在应用中恢复。{impact}
          </p>
          <button className="danger" disabled={blocked} onClick={() => void act('delete')}>
            确认永久删除
          </button>
          <button className="secondary" disabled={blocked} onClick={() => setConfirmation(null)}>
            取消删除
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {page.items.map((item, index) => (
        <article className="history-select-row" key={identity(item)}>
          <input
            type="checkbox"
            aria-label={`选择${label} 第${page.page * 20 + index + 1}条`}
            checked={selectedSet.has(identity(item))}
            disabled={blocked}
            onChange={() =>
              select(
                selectedSet.has(identity(item))
                  ? selected.filter((id) => id !== identity(item))
                  : [...selected, identity(item)],
              )
            }
          />
          <Fragment>{render(item)}</Fragment>
        </article>
      ))}
      <ListPager
        label={`${label}分页`}
        page={page.page}
        pages={page.pages}
        disabled={blocked}
        onChange={setPage}
      />
      {!items.length && <p>本页没有{label}。</p>}
    </>
  );
}
