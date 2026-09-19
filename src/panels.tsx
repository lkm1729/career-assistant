import { versionLabel } from '../shared/version-display';
import { ConnectionBadge } from './RunInfo';
import { resolvedConnection } from '../shared/models';
import { ResultHeader, ResultJump } from './ResultHeader';
import { referenceLabels, readableReferences } from '../shared/reference-display';
import { WorkbenchFeedback } from './WorkbenchFeedback';
import { Materials } from './Materials';
import type { ScoreState } from './useScore';
import type { MatchState } from './useMatch';
import { ModelPicker, PageParameters } from './ModelPicker';
import { useAi } from './useAi';
import { GeneratedAdvice } from './ai-controls';
import { useState, useRef, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import {
  FileText,
  ImagePlus,
  Paperclip,
  Link2,
  LockKeyhole,
  Sparkles,
  LoaderCircle,
  Copy,
  Download,
  ArrowUpRight,
  History as HistoryIcon,
  PencilLine,
  ScanLine,
  Check,
  ChevronRight,
} from 'lucide-react';
import type { WorkspaceDraft, WorkspaceId, ViewMode } from '../shared/contracts';
import { defaultPrompts } from '../shared/contracts';
import { pages, dimensions } from './content';
import { SystemPrompt } from './controls';

export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 255 170" fill="none" aria-hidden="true">
      <circle cx="143" cy="88" r="74" fill="var(--accent-soft)" />
      <circle cx="208" cy="42" r="5" fill="var(--accent)" opacity=".28" />
      <path
        d="M53 119l9-4m-2 12l7-5M210 104l10 4m-13 3l7 6"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".4"
      />
      <g transform="rotate(-10 130 85)">
        <rect
          x="87"
          y="21"
          width="98"
          height="128"
          rx="12"
          fill="var(--surface)"
          stroke="var(--line)"
          strokeWidth="1.5"
        />
        <circle cx="113" cy="49" r="12" fill="var(--accent-soft)" />
        <path
          d="M108 50a5 5 0 0110 0m-11 7a7 7 0 0112 0"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="135" y="41" width="34" height="5" rx="2.5" fill="var(--text)" opacity=".7" />
        <rect x="135" y="52" width="25" height="4" rx="2" fill="var(--muted)" opacity=".4" />
        {[78, 88, 98, 119, 129].map((y, i) => (
          <rect
            key={y}
            x="102"
            y={y}
            width={i === 2 || i === 4 ? 43 : 67}
            height="4"
            rx="2"
            fill="var(--muted)"
            opacity=".22"
          />
        ))}
      </g>
      <rect
        x="164"
        y="113"
        width="47"
        height="36"
        rx="12"
        fill="var(--accent)"
        transform="rotate(8 188 131)"
      />
      <path
        d="M179 130l6 6 12-13"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M73 60V44m-8 8h16" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
export function InputPanel({
  id,
  draft,
  onChange,
  onSettings,
  score,
  match,
}: {
  score?: ScoreState;
  match?: MatchState;
  id: WorkspaceId;
  draft: WorkspaceDraft;
  onChange: (patch: Partial<WorkspaceDraft>) => void;
  onSettings: () => void;
}) {
  const ai = useAi();
  const page = pages[id];
  const pending =
    id === 'match'
      ? match!.busy || match!.preparing
      : id === 'score'
        ? score!.busy || score!.preparing
        : ai.pageBusy;
  return (
    <section className="card input-panel" aria-labelledby="input-heading">
      <fieldset className="workspace-fields" disabled={pending}>
        <div className="card-heading">
          <div className="section-title">
            <span className="step-number">01</span>
            <h2 id="input-heading">输入资料</h2>
          </div>
          <ModelPicker page={id} onSettings={onSettings} />
        </div>
        <PageParameters key={`parameters-${id}`} page={id} />
        <label className="field-label" htmlFor="user-prompt">
          {page.inputLabel}
          {id === 'score' && <span className="optional">选填</span>}
        </label>
        <div className="prompt-wrap">
          <textarea
            id="user-prompt"
            className="prompt-input"
            placeholder={page.placeholder}
            value={draft.prompt}
            maxLength={100000}
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
          <span className="character-count">{draft.prompt.length.toLocaleString()} 字符</span>
        </div>
        {id === 'letter' && (
          <label className="score-paste">
            用于撰写的简历正文（仅本页使用，不会自动读取设计简历页）
            <textarea
              aria-label="求职信使用的简历正文"
              rows={7}
              maxLength={500000}
              value={draft.resumeText ?? ''}
              onChange={(e) => onChange({ resumeText: e.target.value })}
              placeholder="粘贴希望用于求职信的简历正文或经历摘要。"
            />
          </label>
        )}
        {id === 'match' && (
          <label className="score-paste">
            本页简历正文
            <textarea
              aria-label="匹配使用的简历正文"
              rows={8}
              maxLength={500000}
              value={draft.document}
              onChange={(e) => onChange({ document: e.target.value })}
              placeholder="粘贴用于对照岗位要求的简历正文。"
            />
          </label>
        )}
        {id === 'score' && (
          <label className="score-paste">
            本页简历文字（可替代附件，不能评价视觉排版）
            <textarea
              aria-label="评分简历文字"
              rows={7}
              maxLength={100000}
              value={draft.document}
              onChange={(e) => onChange({ document: e.target.value })}
            />
          </label>
        )}
        <div className="field-row">
          <span className="field-label">参考资料</span>
          <span className="field-hint">{'本页独立资料 · 按用途导入，预览后手动勾选'}</span>
        </div>
        <Materials
          key={`materials-${id}`}
          page={id}
          links={draft.links}
          onLinks={(links) => onChange({ links })}
        />
        {
          <label className="send-image-toggle">
            <input
              type="checkbox"
              checked={
                id === 'score'
                  ? score!.sendImages
                  : id === 'match'
                    ? match!.sendImages
                    : ai.sendImages
              }
              onChange={(e) =>
                id === 'score'
                  ? score!.setSendImages(e.target.checked)
                  : id === 'match'
                    ? match!.setSendImages(e.target.checked)
                    : ai.setSendImages(e.target.checked)
              }
            />
            本次发送页面图像（需模型支持视觉）；取消则仅发送抽取文字，评分不提供完整总分
          </label>
        }
        {(id === 'match' || id === 'letter') && (
          <label className="score-paste">
            本页补充材料文字
            <textarea
              aria-label="本页补充材料文字"
              rows={4}
              maxLength={100000}
              value={draft.evidenceText ?? ''}
              onChange={(e) => onChange({ evidenceText: e.target.value })}
              placeholder="证书、作品或其他可核实的事实；不会读取其他页面。"
            />
          </label>
        )}
        <SystemPrompt
          page={id}
          key={`prompt-${id}`}
          value={draft.systemPrompt}
          defaultValue={defaultPrompts[id]}
          onChange={(systemPrompt) => onChange({ systemPrompt })}
        />
      </fieldset>
      <ConnectionBadge
        connection={
          id === 'score' && score?.busy
            ? score.runningConnection
            : id === 'match' && match?.busy
              ? match.runningConnection
              : (id === 'resume' || id === 'letter') && ai.pageBusy && ai.generating
                ? ai.runningConnection
                : ai.catalog
                  ? resolvedConnection(ai.catalog, id)
                  : null
        }
        label={
          (id === 'score' && score?.busy) ||
          (id === 'match' && match?.busy) ||
          ((id === 'resume' || id === 'letter') && ai.pageBusy && ai.generating)
            ? '本次运行使用'
            : '下次使用'
        }
      />
      <div className="input-footer">
        <div className="privacy-note">
          <LockKeyhole size={14} />
          <span>草稿本地保存；生成前确认发送内容</span>
        </div>
        <button
          className="primary"
          disabled={
            (id === 'match'
              ? !ai.catalog?.pages.match.modelId
              : id === 'score'
                ? !ai.catalog?.pages.score.modelId
                : !ai.connection) ||
            ai.busy ||
            !!ai.testing
          }
          onClick={() =>
            void (id === 'score'
              ? score!.prepare()
              : id === 'match'
                ? match!.prepare()
                : ai.prepare())
          }
          title={id !== 'match' ? '发送前将展示资料与供应商供确认' : '发送前将展示岗位与简历供确认'}
        >
          {pending ? (
            <LoaderCircle size={17} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={17} />
          )}
          {page.action}
          <ArrowUpRight size={17} />
        </button>
      </div>
      <div className="result-navigation">
        <ResultJump page={id} />
        <span>回答、分项依据与建议在下方独立展示</span>
      </div>
      <WorkbenchFeedback id={id} score={score} match={match} />
      <p className="stage-caption">
        {id === 'resume' || id === 'letter'
          ? id === 'resume'
            ? '支持选中的本页资料生成与版本管理；个人项目网页需单独确认读取并勾选。'
            : '支持本页简历、岗位与补充材料生成、调整和恢复求职信；发送前单独确认。'
          : id === 'score'
            ? '固定30/30/20/20权重；视觉缺失或覆盖不完整时仅显示部分评价。'
            : '逐项核实岗位与简历证据；覆盖率不是录用概率或招聘方ATS分数。'}
      </p>
    </section>
  );
}
const markdownComponents = {
  a: ({ children }: { children?: React.ReactNode }) => (
    <span className="inert-link">{children}</span>
  ),
  img: ({ alt }: { alt?: string }) => (
    <span className="image-placeholder">[图片：{alt || '未加载'}]</span>
  ),
};
export function WritingPanel({
  id,
  draft,
  onChange,
  onHistory,
  editRequest,
}: {
  id: WorkspaceId;
  draft: WorkspaceDraft;
  onChange: (patch: Partial<WorkspaceDraft>) => void;
  onHistory: () => void;
  editRequest: number;
}) {
  const ai = useAi();
  const [mode, setMode] = useState<ViewMode>('preview');
  useEffect(() => {
    if (editRequest) setMode('source');
  }, [editRequest]);
  const [message, setMessage] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const version = ai.versions.find((v) => v.number === draft.currentVersionNumber);
  const labels = useMemo(() => referenceLabels(version?.materials), [version?.materials]);
  const displayDocument = useMemo(
    () => readableReferences(draft.document, labels, true),
    [draft.document, labels],
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Confirmation/stream state must not reparse an unchanged document. The exact text
  // remains the dependency, so edits, clear/undo and version changes invalidate it.
  const renderedDocument = useMemo(
    () => (
      <Markdown skipHtml components={markdownComponents}>
        {displayDocument}
      </Markdown>
    ),
    [displayDocument],
  );
  const page = pages[id];
  // The rendered Markdown tree supplies deterministic text without executing HTML or loading remote resources.
  const plainText = () => previewRef.current?.innerText?.trim() ?? '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        mode === 'raw' ? plainText() : mode === 'source' ? draft.document : displayDocument,
      );
      setMessage('已复制正文');
    } catch {
      setMessage('复制失败，请在编辑区手动选择复制');
    }
  }
  async function exportDraft() {
    try {
      const saved = await window.career?.exportDocument(
        id,
        mode === 'raw' ? 'txt' : 'md',
        mode === 'raw' ? plainText() : mode === 'source' ? draft.document : displayDocument,
      );
      setMessage(saved ? '草稿已导出' : '已取消导出');
    } catch {
      setMessage('导出失败，草稿仍保留在工作区');
    }
  }
  return (
    <>
      <fieldset className="workspace-fields" disabled={ai.pageBusy}>
        <section
          className="card output-panel ai-result-panel"
          aria-label={id === 'letter' ? '求职信 AI 回答区' : '简历 AI 回答区'}
        >
          <ResultHeader
            title={page.output}
            pending={ai.pageBusy}
            status={
              ai.generating && ai.pageBusy
                ? draft.document
                  ? '正在生成 · 下方保留原正文'
                  : '正在生成 · 尚未保存'
                : ai.pageBusy
                  ? '正在处理本页操作'
                  : version
                    ? version.document === draft.document
                      ? (ai.versions.some((v) => v.number > version.number)
                          ? '历史 AI 结果 · '
                          : 'AI 正式结果 · ') + versionLabel(ai.versions, version.number)
                      : '手动编辑稿 · 基于 ' + versionLabel(ai.versions, version.number)
                    : draft.document
                      ? '本地草稿 · 非 AI 正式结果'
                      : '等待生成'
            }
          />
          <div className="card-heading">
            <div className="section-title">
              <span className="field-label">当前工作正文</span>
              <span className="pill muted" aria-label="当前正文版本">
                {draft.currentVersionNumber
                  ? `${ai.versions.find((v) => v.number === draft.currentVersionNumber)?.document === draft.document ? '正式版本' : '编辑稿 · 基于'} ${versionLabel(ai.versions, draft.currentVersionNumber)}`
                  : '本地草稿 · 未形成正式版本'}
              </span>
            </div>
            <div className="output-actions">
              <button
                className="icon-button"
                title="复制正文"
                aria-label="复制正文"
                disabled={!draft.document}
                onClick={copy}
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-button"
                title="导出草稿"
                aria-label="导出草稿"
                disabled={!draft.document}
                onClick={exportDraft}
              >
                <Download size={17} />
              </button>
            </div>
          </div>
          <div className="output-toolbar">
            <div className="segmented" role="group" aria-label="正文显示方式">
              {(['preview', 'source', ...(id === 'letter' ? ['raw'] : [])] as ViewMode[]).map(
                (value) => (
                  <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                    {value === 'preview'
                      ? '阅读预览'
                      : value === 'source'
                        ? 'Markdown 编辑'
                        : 'Raw Text'}
                  </button>
                ),
              )}
            </div>
            <label className="working-version">
              工作版本
              <select
                aria-label="切换工作版本"
                value={draft.currentVersionNumber ?? ''}
                disabled={ai.busy || !!ai.testing || !ai.versions.length}
                onChange={(event) =>
                  void ai.switchVersion(Number(event.target.value)).then((ok) => {
                    if (ok) setMode('source');
                  })
                }
              >
                <option value="" disabled>
                  本地草稿
                </option>
                {ai.versions.map((v) => (
                  <option key={v.runId} value={v.number}>
                    {versionLabel(ai.versions, v.number)}
                  </option>
                ))}
              </select>
              {draft.currentVersionNumber && (
                <button
                  className="text-button"
                  disabled={ai.busy || !!ai.testing}
                  onClick={() => {
                    onHistory();
                    void ai.prepareRestore(draft.currentVersionNumber!);
                  }}
                >
                  回滚
                </button>
              )}
            </label>
          </div>
          <div className="document-canvas">
            {mode === 'source' ? (
              <textarea
                ref={editorRef}
                aria-label="正文草稿"
                className="document-editor"
                value={draft.document}
                maxLength={500000}
                onChange={(event) => onChange({ document: event.target.value })}
                placeholder={
                  id === 'resume'
                    ? '# 你的姓名\n\n## 职业摘要\n从这里开始整理真实的经历……'
                    : '尊敬的招聘团队：\n\n从这里开始撰写你的求职信……'
                }
                spellCheck={false}
              />
            ) : !draft.document ? (
              <div className="empty-document">
                <div className="empty-icon">
                  <PencilLine size={28} strokeWidth={1.5} />
                </div>
                <h3>好的表达，从真实经历开始</h3>
                <p>
                  AI 结果将在这里呈现。你也可以先手动整理草稿，
                  <br />
                  所有修改都会保存在当前标签页。
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    setMode('source');
                    requestAnimationFrame(() => editorRef.current?.focus());
                  }}
                >
                  手动撰写草稿
                  <ArrowUpRight size={15} />
                </button>
              </div>
            ) : mode === 'raw' ? (
              <div className="raw-document">{plainText()}</div>
            ) : null}
            <div
              ref={previewRef}
              className={`markdown-body ${mode !== 'preview' || !draft.document ? 'text-extraction' : ''}`}
              aria-hidden={mode !== 'preview' || !draft.document}
            >
              {renderedDocument}
            </div>
          </div>
          <div className="output-footnote">
            <span>
              {message ||
                '阅读预览使用易读引用；Markdown 编辑保留原文与技术编号。复制/导出遵循当前视图。'}
            </span>
            {message && <Check size={14} />}
          </div>
        </section>
        {(id === 'resume' || id === 'letter') && <GeneratedAdvice />}
        <section className="card refinement-panel">
          <div className="card-heading">
            <div className="section-title">
              <span className="step-number">03</span>
              <h2>继续调整与版本</h2>
            </div>
            <button className="text-button" onClick={onHistory}>
              <HistoryIcon size={16} />
              查看记录
            </button>
          </div>
          <label className="sr-only" htmlFor="refinement">
            修改要求
          </label>
          <textarea
            id="refinement"
            rows={2}
            maxLength={50000}
            value={draft.refinement}
            onChange={(event) => onChange({ refinement: event.target.value })}
            placeholder="告诉我还想如何调整，例如：语气更自然，保留项目成果，缩短到一页……"
          />
          <ConnectionBadge
            connection={ai.pageBusy && ai.generating ? ai.runningConnection : ai.connection}
            label={ai.pageBusy && ai.generating ? '本次运行使用' : '下次使用'}
          />
          <div className="refinement-footer">
            <span>修改要求会暂存；成功后创建新的 V 版本，原版本和输入快照仍保留。</span>
            <button
              className="secondary"
              disabled={
                (id !== 'resume' && id !== 'letter') ||
                !ai.connection ||
                ai.busy ||
                !!ai.testing ||
                !draft.refinement.trim() ||
                !draft.document.trim()
              }
              onClick={() => void ai.prepareRefinement()}
            >
              <Sparkles size={15} />
              继续调整
            </button>
          </div>
        </section>
      </fieldset>
      <WorkbenchFeedback
        id={id}
        label={`${id === 'letter' ? '求职信' : '简历'}调整操作反馈`}
        announce={false}
      />
    </>
  );
}
export function EvaluationPanel({ id }: { id: 'score' | 'match' }) {
  const [selected, setSelected] = useState(0);
  return (
    <section className="card evaluation-panel" aria-labelledby="evaluation-heading">
      <div className="card-heading">
        <div className="section-title">
          <span className="step-number">02</span>
          <h2 id="evaluation-heading">{pages[id].output}</h2>
        </div>
        <span className="pill muted">尚未评估</span>
      </div>
      <div className="score-overview">
        <div>
          <span className="small-label">{id === 'score' ? '综合评分' : '岗位匹配度'}</span>
          <div className="score-number">
            —<span>/ 100</span>
          </div>
        </div>
        <div className="score-explanation">
          <div className="score-track" />
          <p>等待真实资料与模型分析 · 不显示演示分数</p>
        </div>
        <ScanLine size={37} strokeWidth={1} />
      </div>
      {id === 'score' ? (
        <>
          <div className="dimension-grid" role="group" aria-label="评分维度">
            {dimensions.map((dimension, index) => (
              <button
                key={dimension.name}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                <span className="dimension-top">
                  {dimension.name}
                  <span>{dimension.weight}</span>
                </span>
                <strong>—</strong>
                <span className="dimension-bottom">
                  查看评价标准
                  <ChevronRight size={13} />
                </span>
              </button>
            ))}
          </div>
          <div className="dimension-description">
            <h3>{dimensions[selected].name}</h3>
            <p>{dimensions[selected].description}</p>
            <span>目前展示的是评价标准，不是对你的简历的评价。</span>
          </div>
        </>
      ) : (
        <div className="match-outline">
          <h3>每一项匹配，都应该有依据</h3>
          <div>
            <span>岗位要求</span>
            <span>用户材料中的证据</span>
            <span>匹配状态</span>
          </div>
          <p>分析后将逐项呈现证据、优势与差距，并单独提示硬性条件。</p>
        </div>
      )}
      <div className="summary-block">
        <h3>Summary</h3>
        <p>
          {id === 'score'
            ? '完成分析后，这里将总结评分依据与优先改进建议。视觉资料不足时会明确标注，不生成完整总分。'
            : '完成分析后，这里将给出是否建议申请及理由。未找到证据，不等于你没有这项能力。'}
        </p>
      </div>
    </section>
  );
}
