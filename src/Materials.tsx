import { materialLimits } from '../shared/materials';
import { visibleMaterialWarnings } from '../shared/material-warnings';
import { ActionFeedback } from './ActionFeedback';
import { runWebBatch, type WebImportRow } from './web-import';
import { publicJobEndpoint } from '../shared/web-sources';
import { useEffect, useState, useRef } from 'react';
import { LoaderCircle, Paperclip, Link2, Upload } from 'lucide-react';
import type {
  Material,
  MaterialPage,
  MaterialPurpose,
  MaterialManifest,
  FileImportDraft,
  FilePickReply,
} from '../shared/materials';
import { useAi } from './useAi';
import { DiagnosticPanel } from './DiagnosticPanel';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
export const purposeLabel = { resume: '简历 / 经历', job: '目标岗位', evidence: '补充材料' };
export function MaterialPreview({ item }: { item: Material }) {
  return (
    <div className="material-preview">
      {(item.sourceKind || item.sourceUrl) && (
        <p>
          {item.sourceKind === 'pasted'
            ? '本地粘贴补充 · 未访问/核验网页'
            : '网页文字快照 · 待人工核对完整性'}
          {item.sourceTitle && <> · 标题：{item.sourceTitle}</>}
        </p>
      )}
      {item.retrievedUrl && item.retrievedUrl !== item.sourceUrl && (
        <p>
          实际读取来源：<code>{item.retrievedUrl}</code>
        </p>
      )}
      {item.sourceUrl && (
        <p>
          来源：<code>{item.sourceUrl}</code> · 获取时间：
          {new Date(item.createdAt).toLocaleString()}
        </p>
      )}
      {item.error && <p className="material-warning">{item.error}</p>}
      {visibleMaterialWarnings(item.warnings).map((w, i) => (
        <p className="material-warning" key={i}>
          {w}
        </p>
      ))}
      {item.pages.map((p) => (
        <details key={p.number}>
          <summary>
            第 {p.number} 页 · {p.text.length} 字符 {p.image ? '· 有页面图像' : '· 无图像'}{' '}
            {p.ocr ? `· OCR ${Math.round(p.ocr.confidence)}%` : ''}
          </summary>
          {p.image && (
            <img src={p.image} alt={`${item.name} 第${p.number}页本机预览`} loading="lazy" />
          )}
          {p.warnings.map((w, i) => (
            <p className="material-warning" key={i}>
              {w}
            </p>
          ))}
          <pre>{p.text || '未抽取到文字，请核对原图或补充文本。'}</pre>
        </details>
      ))}
    </div>
  );
}
export function Materials({
  page,
  links = '',
  onLinks,
}: {
  page: MaterialPage;
  links?: string;
  onLinks?: (value: string) => void;
}) {
  const ai = useAi();
  const [webPurpose, setWebPurpose] = useState<MaterialPurpose>(
    page === 'resume' ? 'evidence' : 'job',
  );
  const [webConsent, setWebConsent] = useState<{
    entries: { url: string; purpose: MaterialPurpose }[];
    allowPublicDns: boolean;
  } | null>(null);
  const cancelled = useRef(false);
  const operationLock = useRef(false);
  const [webRows, setWebRows] = useState<WebImportRow[]>([]);
  const [paste, setPaste] = useState({ title: '', text: '', sourceUrl: '' });
  const [items, setItems] = useState<Material[]>([]);
  const [purpose, setPurpose] = useState<MaterialPurpose>('resume');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<AiDiagnostic | null>(null);
  const [remove, setRemove] = useState<Material[] | null>(null);
  const [manage, setManage] = useState(false);
  const [checkedRemove, setCheckedRemove] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [actionTarget, setActionTarget] = useState('files');
  const [pendingMessage, setPendingMessage] = useState('');
  const [cancellable, setCancellable] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [removeAnchor, setRemoveAnchor] = useState('batch');
  const [removedRow, setRemovedRow] = useState<{ item: Material; index: number } | null>(null);
  const [fileDraft, setFileDraft] = useState<
    | (Omit<FileImportDraft, 'files'> & {
        files: (FileImportDraft['files'][number] & { purpose: MaterialPurpose })[];
      })
    | null
  >(null);
  const draftId = useRef<string | null>(null);
  const mounted = useRef(true);
  const locked = busy || ai.busy || !!ai.testing;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (draftId.current)
        void window.career?.materials.discardPickedFiles(page, draftId.current).catch(() => {});
    };
  }, [page]);
  useEffect(() => {
    setCheckedRemove((ids) => ids.filter((id) => items.some((item) => item.id === id)));
  }, [items]);
  async function acceptFiles(result: FilePickReply) {
    if (!result.ok) return result;
    if (result.draft) {
      if (!mounted.current)
        await window.career!.materials.discardPickedFiles(page, result.draft.id);
      else {
        draftId.current = result.draft.id;
        setFileDraft({
          ...result.draft,
          files: result.draft.files.map((file) => ({ ...file, purpose })),
        });
      }
    }
    return { ok: true as const, items: await window.career!.materials.list(page) };
  }
  function transferFiles(files: File[]) {
    if (locked || fileDraft || operationLock.current || !files.length) return;
    void act(async () => {
      if (files.length > materialLimits.files || files.length + items.length > materialLimits.files)
        return {
          ok: false as const,
          diagnostic: messageDiagnostic('本页最多16项资料，请减少文件或先移除旧资料。'),
        };
      for (const file of files) {
        if (!/\.(pdf|docx|txt|md|png|jpe?g|webp)$/i.test(file.name))
          return {
            ok: false as const,
            diagnostic: messageDiagnostic(
              '不支持此文件格式，请使用PDF、DOCX、TXT/MD、PNG/JPEG/WebP。',
            ),
          };
        if (!file.size || file.size > materialLimits.fileBytes)
          return { ok: false as const, diagnostic: messageDiagnostic('文件为空或超过12 MiB。') };
      }
      const transferred = [];
      for (const file of files)
        transferred.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      return acceptFiles(await window.career!.materials.stageFiles(page, transferred));
    });
  }
  function discardFiles() {
    if (draftId.current)
      void window.career!.materials.discardPickedFiles(page, draftId.current).catch(() => {});
    draftId.current = null;
    setFileDraft(null);
  }
  function confirmRemove() {
    if (!remove || locked) return;
    const snapshot = remove;
    const anchor = removeAnchor;
    const index = items.findIndex((i) => i.id === anchor);
    setRemove(null);
    void act(
      async () => {
        const result = await window.career!.materials.removeMany(
          page,
          snapshot.map(({ id, revision }) => ({ id, revision })),
        );
        if (result.ok) {
          setCheckedRemove([]);
          if (anchor !== 'batch') setRemovedRow({ item: snapshot[0], index });
          setNotice(`已从本页移除 ${snapshot.length} 项资料；原文件和历史快照保留。`);
        }
        return result;
      },
      undefined,
      { target: anchor, message: '正在从本页移除所选资料…' },
    );
  }
  useEffect(() => {
    let active = true;
    window.career?.materials
      .list(page)
      .then((v) => {
        if (active) setItems(v);
      })
      .catch(() => {
        if (active) setError(messageDiagnostic('无法读取本页资料，请重试。'));
      });
    return () => {
      active = false;
    };
  }, [page]);
  async function act(
    operation: () => Promise<import('../shared/materials').MaterialReply>,
    rollback?: Material[],
    context: { target: string; message?: string; success?: string; cancellable?: boolean } = {
      target: 'files',
    },
  ) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    ai.setExtraBusy(true);
    setError(null);
    setNotice('');
    setActionTarget(context.target);
    setPendingMessage(context.message ?? '正在本机解析或保存…');
    setCancellable(context.cancellable ?? false);
    setCancelling(false);
    setRemovedRow(null);
    try {
      const r = await operation();
      if (r.ok) {
        setItems(r.items);
        if (context.success) setNotice(context.success);
      } else {
        if (rollback) setItems(rollback);
        else setItems(await window.career!.materials.list(page));
        setError(r.diagnostic);
      }
    } catch {
      if (rollback) setItems(rollback);
      setError(messageDiagnostic('本地资料操作失败，请保留原文件并重试。'));
    } finally {
      operationLock.current = false;
      setBusy(false);
      ai.setExtraBusy(false);
    }
  }
  function feedback(target: string) {
    if (actionTarget !== target) return null;
    return (
      <div className="material-local-feedback">
        <ActionFeedback
          label="资料操作反馈"
          pending={busy}
          message={
            busy
              ? cancelling
                ? '正在请求停止读取，已成功保存的资料保留…'
                : pendingMessage
              : error
                ? ''
                : notice
          }
          cancelling={cancelling}
          cancelLabel="取消读取/解析"
          onCancel={
            cancellable
              ? () => {
                  if (cancelled.current) return;
                  cancelled.current = true;
                  setCancelling(true);
                  void window.career!.materials.cancelImport().catch(() => {
                    cancelled.current = false;
                    setCancelling(false);
                    setError(messageDiagnostic('取消请求未确认，请等待当前读取结束或重试。'));
                  });
                }
              : undefined
          }
        />
        {error && <DiagnosticPanel diagnostic={error} />}
      </div>
    );
  }
  function beginRemove(selected: Material[], anchor: string) {
    setRemove(selected);
    setRemoveAnchor(anchor);
    setNotice('');
    setError(null);
    setRemovedRow(null);
  }
  const removalConfirmation = remove && (
    <div className="confirm-inline" role="alertdialog" aria-label="确认移除资料">
      <h3>从本页移除 {remove.length} 项资料？</h3>
      <ul>
        {remove.map((item) => (
          <li key={item.id}>
            {item.name} · {purposeLabel[item.purpose]}
          </li>
        ))}
      </ul>
      <p>原文件及历史输入快照保留。此操作不是安全擦除；资料副本仍在本地数据库。</p>
      <button className="danger" disabled={locked} onClick={confirmRemove}>
        确认移除
      </button>
      <button disabled={locked} onClick={() => setRemove(null)}>
        取消
      </button>
    </div>
  );
  const displayItems = [...items];
  if (removedRow)
    displayItems.splice(Math.max(0, Math.min(removedRow.index, items.length)), 0, removedRow.item);
  return (
    <section className="materials" aria-label="本页附件资料">
      {onLinks && (
        <details className="link-drafts material-entry material-entry-web" open>
          <summary>
            <Link2 size={21} aria-hidden="true" />
            <strong>添加参考网页链接</strong>
            <small>网页参考资料 · 岗位 / 个人项目 / 在线简历</small>
          </summary>
          <label>
            网页默认用途（确认时可逐条修改）
            <select
              aria-label="网页资料用途"
              value={webPurpose}
              disabled={busy || ai.busy}
              onChange={(e) => setWebPurpose(e.target.value as MaterialPurpose)}
            >
              <option value="resume">简历 / 经历</option>
              <option value="job">目标岗位</option>
              <option value="evidence">补充材料</option>
            </select>
          </label>
          <label>
            网页链接草稿
            <textarea
              aria-label="网页链接草稿"
              rows={3}
              maxLength={20000}
              value={links}
              disabled={busy || ai.busy}
              onChange={(e) => onLinks(e.target.value)}
              placeholder="每行一个公开 HTTPS 链接，单次最多5个。读取结果不自动勾选。"
            />
          </label>
          <button
            className="secondary"
            disabled={busy || ai.busy || !!ai.testing || !links.trim()}
            onClick={() => {
              const urls = links
                .split(/\r?\n/)
                .map((v) => v.trim())
                .filter(Boolean);
              setActionTarget('web');
              setNotice('');
              setError(null);
              if (urls.length > 5) {
                setError(messageDiagnostic('单次最多读取5个链接，请分批操作。'));
                return;
              }
              setWebConsent({
                entries: [...new Set(urls)].map((url) => ({ url, purpose: webPurpose })),
                allowPublicDns: false,
              });
            }}
          >
            读取网页前确认
          </button>
          {feedback('web')}
          <p className="field-hint">
            访问网站需要联网，会暴露你的网络IP；不发送简历、API
            Key、Cookies或登录状态。静态读取不绕过登录/验证码，失败可粘贴正文或导入截图。跨网站跳转需你确认最终地址后重新粘贴。
          </p>
        </details>
      )}
      {webConsent && (
        <div className="confirm-inline" role="dialog" aria-label="确认访问网页">
          <h3>确认访问以下网站并保存本页文字快照？</h3>
          <p>
            请逐条设置用途。此处只读取网页，不会发送给模型；保存后核对正文并手动勾选。个人项目一般选择“补充材料”。
          </p>
          {webConsent.entries.map(({ url, purpose: rowPurpose }, i) => (
            <div key={i}>
              <pre>{url}</pre>
              <label className="material-purpose-field">
                本条用途
                <select
                  aria-label={`第${i + 1}个网页用途`}
                  value={rowPurpose}
                  disabled={locked}
                  onChange={(e) =>
                    setWebConsent({
                      ...webConsent,
                      entries: webConsent.entries.map((row, index) =>
                        index === i ? { ...row, purpose: e.target.value as MaterialPurpose } : row,
                      ),
                    })
                  }
                >
                  {Object.entries(purposeLabel).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {publicJobEndpoint(url) && (
                <p>
                  此动态岗位页将读取网站的公开数据接口：<code>{publicJobEndpoint(url)}</code>
                  。不使用登录状态或执行网页脚本。
                </p>
              )}
            </div>
          ))}
          <label>
            <input
              type="checkbox"
              checked={webConsent.allowPublicDns}
              onChange={(e) => setWebConsent({ ...webConsent, allowPublicDns: e.target.checked })}
            />
            允许公共 DNS 兼容解析（仅本次）
          </label>
          <p className="field-hint">
            默认关闭。仅当本机 DNS 全部返回 198.18.0.0/15 保留地址（可能是代理 Fake-IP）时， 向
            Cloudflare 公共 DNS（cloudflare-dns.com / 1.1.1.1）查询上方实际读取地址的主机名。
            Cloudflare 会获知该主机名和网络 IP，不接收链接路径、查询参数、简历、Key 或 Cookies。
            返回地址仍须通过公网检查并锁定连接；失败不放行保留地址、不自动重试。
          </p>
          <button
            className="primary"
            disabled={locked}
            onClick={() => {
              const consent = webConsent;
              setWebConsent(null);
              cancelled.current = false;
              void act(
                async () => {
                  const rows = await runWebBatch(
                    consent.entries.map((row) => row.url),
                    (url) =>
                      window.career!.materials.importUrl(
                        page,
                        consent.entries.find((row) => row.url === url)!.purpose,
                        url,
                        consent.allowPublicDns,
                      ),
                    () => cancelled.current,
                    setWebRows,
                    setItems,
                  );
                  setNotice(
                    `本次网页读取结束：成功 ${rows.filter((r) => r.status === 'ready').length} 项；失败 ${rows.filter((r) => r.status === 'failed').length} 项；未完成 ${rows.filter((r) => ['cancelled', 'skipped'].includes(r.status)).length} 项。`,
                  );
                  return { ok: true, items: await window.career!.materials.list(page) };
                },
                undefined,
                { target: 'web', message: '正在读取已确认网页…', cancellable: true },
              );
            }}
          >
            确认访问并读取
          </button>
          <button onClick={() => setWebConsent(null)}>取消</button>
        </div>
      )}
      {onLinks && webRows.length > 0 && (
        <section aria-label="本次网页读取状态" aria-live="polite">
          <h3>逐链接读取结果（仅本次会话）</h3>
          {webRows.map((row, index) => (
            <article className="web-read-result" key={index}>
              <code>{row.url}</code>
              <strong>
                {
                  {
                    pending: '等待读取',
                    reading: '正在读取',
                    ready: '已保存快照 · 未自动勾选',
                    failed: '读取失败',
                    cancelled: '已取消',
                    skipped: '未读取（已取消）',
                  }[row.status]
                }
              </strong>
              {row.diagnostic && <DiagnosticPanel diagnostic={row.diagnostic} />}
            </article>
          ))}
          <p className="field-hint">
            成功项独立保留；失败项不自动重试。可修改链接后重新确认，或使用下方本地补充。
          </p>
        </section>
      )}
      {onLinks && (
        <details className="web-paste-fallback">
          <summary>网页读取失败？本地粘贴补充 / 截图说明</summary>
          <p>
            不访问网站。按上方“网页资料用途”保存本页文字，预览后手动勾选；不会冒充网页读取成功。截图/PDF
            请在下方按对应用途导入。
          </p>
          <label>
            补充资料标题
            <input
              aria-label="补充资料标题"
              maxLength={240}
              value={paste.title}
              disabled={busy || ai.busy}
              onChange={(e) => setPaste({ ...paste, title: e.target.value })}
            />
          </label>
          <label>
            补充资料来源（可选公开 HTTPS）
            <input
              aria-label="补充资料来源"
              maxLength={4096}
              value={paste.sourceUrl}
              disabled={busy || ai.busy}
              onChange={(e) => setPaste({ ...paste, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            补充资料正文
            <textarea
              aria-label="补充资料正文"
              rows={6}
              maxLength={120000}
              value={paste.text}
              disabled={busy || ai.busy}
              onChange={(e) => setPaste({ ...paste, text: e.target.value })}
            />
          </label>
          <button
            disabled={busy || ai.busy || !!ai.testing || !paste.title.trim() || !paste.text.trim()}
            onClick={() =>
              void act(
                async () => {
                  const result = await window.career!.materials.importText(page, webPurpose, paste);
                  if (result.ok) setPaste({ title: '', text: '', sourceUrl: '' });
                  return result;
                },
                undefined,
                {
                  target: 'paste',
                  message: '正在保存本地补充…',
                  success: '本地补充已保存；核对后勾选发送。',
                },
              )
            }
          >
            保存本地补充（不联网）
          </button>
          {feedback('paste')}
        </details>
      )}
      <section
        className={`material-entry material-entry-files${dragging ? ' is-dragging' : ''}`}
        aria-label="添加参考文件"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = locked || fileDraft ? 'none' : 'copy';
          setDragging(!locked && !fileDraft);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          transferFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <h3>
          <Upload size={21} aria-hidden="true" />
          添加参考文件<small>本地文档与图片 · 确认用途后导入</small>
        </h3>
        <div className="material-toolbar">
          <label>
            文件默认用途
            <select
              aria-label="资料用途"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as MaterialPurpose)}
              disabled={busy || ai.busy}
            >
              {Object.entries(purposeLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={locked || !!fileDraft}
            onClick={() =>
              void act(async () => {
                return acceptFiles(await window.career!.materials.pickFiles(page));
              })
            }
          >
            <Paperclip size={16} />
            多选导入文件 / 图片
          </button>
        </div>
        <div
          className="material-dropzone"
          tabIndex={0}
          role="group"
          aria-label="拖拽或粘贴参考文件"
          aria-disabled={locked || !!fileDraft}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              transferFiles(files);
            }
          }}
        >
          <strong>将图片或文件拖到这里</strong>
          <span>也可点击此区域后按 Ctrl+V 粘贴图片或剪贴板文件；不会自动上传。</span>
          <button
            className="secondary"
            disabled={locked || !!fileDraft}
            onClick={() =>
              void act(async () => acceptFiles(await window.career!.materials.pasteImage(page)))
            }
          >
            粘贴剪贴板图片
          </button>
          <span className="field-hint">
            若系统未提供可粘贴的文件，请直接拖入文件；纯文字和路径不会作为文件读取。
          </span>
        </div>
        {feedback('files')}
        {fileDraft && (
          <section
            className="confirm-inline file-import-queue"
            role="region"
            aria-label="逐项设置文件用途"
          >
            <h3>导入前逐项设置用途</h3>
            <p>
              已选择 {fileDraft.files.length}{' '}
              项。还未解析或保存，不会上传；可分别选择简历、目标岗位或补充材料。
            </p>
            {fileDraft.files.map((file, index) => (
              <div className="material-import-row" key={file.id}>
                <strong>{file.name}</strong>
                <select
                  aria-label={`第${index + 1}个文件用途`}
                  value={file.purpose}
                  disabled={locked}
                  onChange={(e) =>
                    setFileDraft({
                      ...fileDraft,
                      files: fileDraft.files.map((f) =>
                        f.id === file.id ? { ...f, purpose: e.target.value as MaterialPurpose } : f,
                      ),
                    })
                  }
                >
                  {Object.entries(purposeLabel).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="text-button"
                  disabled={locked}
                  aria-label={`取消导入 ${file.name}`}
                  onClick={() => {
                    if (fileDraft.files.length === 1) discardFiles();
                    else
                      setFileDraft({
                        ...fileDraft,
                        files: fileDraft.files.filter((f) => f.id !== file.id),
                      });
                  }}
                >
                  移出清单
                </button>
              </div>
            ))}
            <button
              className="primary"
              disabled={locked || items.length + fileDraft.files.length > 16}
              onClick={() => {
                const draft = fileDraft;
                draftId.current = null;
                setFileDraft(null);
                cancelled.current = false;
                void act(
                  () =>
                    window.career!.materials.importPickedFiles(
                      page,
                      draft.id,
                      draft.files.map(({ id, purpose }) => ({ id, purpose })),
                    ),
                  undefined,
                  {
                    target: 'files',
                    message: '正在本机解析已确认文件…',
                    success: '本次文件处理已结束，请逐项核对解析结果；未自动发送。',
                    cancellable: true,
                  },
                );
              }}
            >
              确认用途并导入
            </button>
            <button disabled={locked} onClick={discardFiles}>
              取消本次文件导入
            </button>
            {items.length + fileDraft.files.length > 16 && (
              <p role="alert">本页最多16项资料，请从清单移出部分文件或先移除旧资料。</p>
            )}
          </section>
        )}
        <p className="field-hint">
          仅本机解析 PDF、DOCX、UTF-8 TXT/MD、PNG/JPEG/WebP。每项 ≤12
          MiB、每页最多16项、每文件最多解析8页；OCR
          为内置中英文。导入后请逐项预览并勾选，不自动上传。
        </p>
      </section>
      {items.length > 0 && (
        <div className="material-batch-toolbar">
          <button
            className="secondary"
            disabled={locked}
            aria-pressed={manage}
            onClick={() => {
              setManage(!manage);
              setCheckedRemove([]);
              setRemove(null);
            }}
          >
            {manage ? '退出批量管理' : '批量管理'}
          </button>
          {manage && (
            <>
              <label>
                <input
                  type="checkbox"
                  aria-label="全选待移除资料"
                  disabled={locked}
                  checked={items.length > 0 && checkedRemove.length === items.length}
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        checkedRemove.length > 0 && checkedRemove.length < items.length;
                  }}
                  onChange={(e) =>
                    setCheckedRemove(e.target.checked ? items.map((item) => item.id) : [])
                  }
                />
                全选待移除资料
              </label>
              <span>
                已选 {checkedRemove.length} / {items.length} 项
              </span>
              <button
                className="danger"
                disabled={locked || !checkedRemove.length}
                onClick={() =>
                  beginRemove(
                    items.filter((item) => checkedRemove.includes(item.id)),
                    'batch',
                  )
                }
              >
                移除所选资料
              </button>
              <small>这里的选择仅用于移除，不改变发送给 AI 的勾选。</small>
            </>
          )}
        </div>
      )}
      {feedback('batch')}
      {removeAnchor === 'batch' && removalConfirmation}
      {displayItems.map((item) =>
        removedRow?.item.id === item.id ? (
          <article
            className="material-removed-feedback"
            key={item.id}
            aria-label={`资料移除结果 ${item.name}`}
          >
            <strong>{item.name}</strong>
            {feedback(item.id)}
            <button className="text-button" onClick={() => setRemovedRow(null)}>
              收起移除结果
            </button>
          </article>
        ) : (
          <article className="material-item" key={item.id}>
            <div className="material-item-header">
              {manage && (
                <label className="material-remove-choice">
                  <input
                    type="checkbox"
                    aria-label={`选择移除 ${item.name}`}
                    checked={checkedRemove.includes(item.id)}
                    disabled={locked}
                    onChange={(e) =>
                      setCheckedRemove((ids) =>
                        e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                      )
                    }
                  />
                  待移除
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  aria-label={`发送资料 ${item.name}`}
                  checked={item.selected}
                  disabled={busy || ai.busy || !!ai.testing || item.status === 'failed'}
                  onChange={(e) => {
                    if (operationLock.current) return;
                    const selected = e.target.checked;
                    const previous = items;
                    setItems(items.map((i) => (i.id === item.id ? { ...i, selected } : i)));
                    void act(
                      () => window.career!.materials.select(page, item.id, item.revision, selected),
                      previous,
                      {
                        target: item.id,
                        success: selected
                          ? '已选入本次发送清单；确认发送前不会上传。'
                          : '已取消发送此资料。',
                      },
                    );
                  }}
                />
                <span className="material-send-label">发送给 AI</span>
                <strong>{item.name}</strong>
              </label>
              <span>
                {item.status === 'failed'
                  ? '失败'
                  : item.status === 'partial'
                    ? '部分成功'
                    : '已解析'}{' '}
                · {item.pages.length}/{item.totalPages}页
              </span>
              <button
                className="text-button danger"
                disabled={busy || ai.busy || !!ai.testing}
                onClick={() => beginRemove([item], item.id)}
              >
                移除
              </button>
            </div>
            {removeAnchor === item.id && removalConfirmation}
            {feedback(item.id)}
            <label className="material-purpose-field">
              此资料用途
              <select
                aria-label={`资料用途 ${item.name}`}
                value={item.purpose}
                disabled={locked}
                onChange={(e) => {
                  const next = e.target.value as MaterialPurpose;
                  void act(
                    () => window.career!.materials.setPurpose(page, item.id, item.revision, next),
                    undefined,
                    { target: item.id, success: '资料用途已保存；发送前请重新核对。' },
                  );
                }}
              >
                {Object.entries(purposeLabel).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <small>
              读取于 {new Date(item.createdAt).toLocaleString()} · 原文件不修改 ·{' '}
              {Math.ceil(item.bytes / 1024)} KiB
            </small>
            <MaterialPreview item={item} />
          </article>
        ),
      )}
      {!items.length && <p>本页尚无资料。其他标签页的附件不会出现在这里。</p>}
    </section>
  );
}
export function MaterialSendPreview({ manifest }: { manifest: MaterialManifest | null }) {
  if (!manifest) return null;
  return (
    <section className="material-send-preview">
      <h3>
        本次资料清单 · {manifest.items.length} 项 · {manifest.imageCount} 张图 ·{' '}
        {manifest.textCount} 字符
      </h3>
      {visibleMaterialWarnings(manifest.warnings).map((w, i) => (
        <p key={i} className="material-warning">
          {w}
        </p>
      ))}
      {manifest.items.map((item) => (
        <details key={item.id}>
          <summary>
            {purposeLabel[item.purpose]} · {item.name} · {item.pages.length}/{item.totalPages} 页
          </summary>
          <MaterialPreview item={item} />
        </details>
      ))}
      {!manifest.items.length && <p>未选中附件，仅发送下方明确列出的文字。</p>}
    </section>
  );
}
