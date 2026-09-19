import { ConfirmationIntro, ConnectionDetails, Disclosure } from './RunInfo';
import { BulkHistory } from './BulkHistory';
import { referenceLabels, readableReferences } from '../shared/reference-display';
import { EvidenceQuote } from './EvidenceQuote';
import { ResultHeader } from './ResultHeader';
import { AdviceText } from './Advice';
import { AssessmentWaitNotice } from './AssessmentWaitNotice';
import { MatchSummary } from './MatchSummary';
import { ActionFeedback } from './ActionFeedback';
import { jobReviewSources } from '../shared/job-review';
import { JobSourceReview } from './JobSourceReview';
import { useEffect, useRef, useState } from 'react';
import {
  matchFormatInstruction,
  matchTaskInstruction,
  matchOutputInstruction,
  type MatchFailurePreview,
} from '../shared/matching';
import { MaterialSendPreview } from './Materials';
import { Modal } from './Modal';
import type { MatchState } from './useMatch';
import { DiagnosticPanel } from './DiagnosticPanel';
const status: { [key: string]: string } = {
  met: '已体现',
  partial: '部分体现',
  'not-found': '未找到证据',
  uncertain: '待确认',
};
export function MatchPanel({ match }: { match: MatchState }) {
  const r = match.current;
  const labels = referenceLabels(r?.materials, r?.sources);
  return (
    <section className="card evaluation-panel ai-result-panel" aria-label="岗位匹配 AI 回答区">
      <ResultHeader
        title="岗位匹配度评估"
        pending={match.busy || match.preparing}
        status={
          match.busy
            ? r
              ? '正在匹配 · 下方保留已保存结果'
              : '正在匹配 · 尚未保存'
            : match.preparing
              ? '准备发送确认'
              : r
                ? match.records[0]?.id === r.id
                  ? '已保存独立匹配'
                  : '历史匹配 · 已恢复显示'
                : '尚未评估'
        }
      />
      {match.error && <DiagnosticPanel diagnostic={match.error} />}
      {match.previewRunId && (
        <FailedMatchPreview key={match.previewRunId} runId={match.previewRunId} />
      )}
      {match.busy && (
        <ActionFeedback
          label="匹配运行概况"
          pending
          announce={false}
          message={match.cancelling ? '正在请求停止匹配…' : '正在逐项对照岗位要求…'}
          cancelling={match.cancelling}
          onCancel={() => void match.cancel()}
          cancelLabel="取消匹配"
        />
      )}
      {r ? (
        <>
          <MatchSummary record={r} />
          <details className="match-evidence-details">
            <summary>逐项岗位要求与来源证据</summary>
            <div className="match-requirements">
              {r.requirements.map((q) => (
                <article key={q.id}>
                  <header>
                    <strong>{readableReferences(q.requirement, labels)}</strong>
                    <span>
                      {q.hard ? '硬性条件 · ' : ''}
                      {status[q.status]}
                    </span>
                  </header>
                  <AdviceText text={q.note} listFallback={false} labels={labels} />
                  {q.jobEvidence.map((e, i) => (
                    <EvidenceQuote
                      key={'j' + i}
                      sourceId={e.sourceId}
                      quote={e.quote}
                      labels={labels}
                      kind="岗位依据"
                    />
                  ))}
                  {q.evidence.map((e, i) => (
                    <EvidenceQuote
                      key={i}
                      sourceId={e.sourceId}
                      quote={e.quote}
                      labels={labels}
                      kind="经历依据"
                    />
                  ))}
                </article>
              ))}
            </div>
          </details>
          <details>
            <summary>本次输入快照与来源</summary>
            <pre>{JSON.stringify({ input: r.input, sources: r.sources }, null, 2)}</pre>
          </details>
        </>
      ) : (
        <>
          <p>导入并勾选本页简历PDF，读取并勾选岗位网页，或粘贴正文后开始匹配。</p>
          <div className="match-outline">
            <span>岗位要求</span>
            <span>简历证据</span>
            <span>匹配状态</span>
          </div>
        </>
      )}
      <MatchHistory match={match} />
    </section>
  );
}
export function MatchHistory({ match }: { match: MatchState }) {
  return (
    <details className="score-history">
      <summary className="assessment-history-toggle">
        <span>独立匹配历史 · {match.records.length} 条</span>
        <span className="history-toggle-hint">展开 / 收起记录</span>
      </summary>
      {match.error && <DiagnosticPanel diagnostic={match.error} />}
      <BulkHistory
        items={match.records}
        identity={(r) => r.id}
        label="匹配历史"
        disabled={match.selectionDisabled}
        revision={match.historyRevision}
        impact="仅删除历史列表记录；当前工作台结果、清空撤销备份、输入正文、原始资料和其他标签页保持不变。当前结果作为本地副本保留；如需移除显示，请单独清空工作台。"
        remove={(items, revision) =>
          match.deleteMany(
            items.map((r) => r.id),
            revision,
          )
        }
        render={(r) => (
          <button
            className="secondary"
            disabled={match.selectionDisabled}
            onClick={() => void match.setCurrent(r)}
          >
            {new Date(r.createdAt).toLocaleString()} · {r.recommendation} · 恢复显示
          </button>
        )}
      />
    </details>
  );
}
export function MatchConfirmation({ match }: { match: MatchState }) {
  const c = match.confirmation;
  if (!c) return null;
  return (
    <Modal title="确认岗位匹配" onClose={() => match.setConfirmation(null)}>
      <ConfirmationIntro
        operation="岗位匹配"
        connection={c.connection}
        materials={c.materials ?? null}
        input={c.input}
      />
      <JobSourceReview
        sources={jobReviewSources(c.materials, c.input.job)}
        confirmed={c.sameJobConfirmed === true}
        onChange={(sameJobConfirmed) => match.setConfirmation({ ...c, sameJobConfirmed })}
      />
      <Disclosure title="查看本次发送内容">
        <MaterialSendPreview manifest={c.materials ?? null} />
        <details>
          <summary>岗位描述</summary>
          <pre>{c.input.job}</pre>
        </details>
        <details>
          <summary>简历正文</summary>
          <pre>{c.input.resume}</pre>
        </details>
        <details>
          <summary>补充材料文字</summary>
          <pre>{c.input.evidence || '未提供'}</pre>
        </details>
        <details>
          <summary>系统提示词</summary>
          <pre>{c.input.systemPrompt}</pre>
        </details>{' '}
      </Disclosure>
      <ConnectionDetails connection={c.connection}>
        <p className="confirmation-warning">
          本次输出上限：{c.connection.parameters?.maxCompletionTokens ?? '未指定，使用供应商默认值'}{' '}
          tokens。逐项匹配比文本探针需要更多输出；部分模型的预算可能包含推理内容。需要调整时请返回“本页参数”，启用模型支持的输出上限后重新确认。程序不会自动增加预算、续写或重试付费请求。
        </p>
        {c.connection.protocol === 'anthropic' && <AssessmentWaitNotice />}
        <p className="confirmation-warning">
          本次输出格式：
          {c.outputMode === 'anthropic-json-schema'
            ? 'Anthropic 原生 JSON Schema'
            : c.outputMode === 'chat-json-schema'
              ? 'Chat Completions JSON Schema'
              : '提示词 JSON'}
          。
          {c.outputMode === 'anthropic-json-schema' || c.outputMode === 'chat-json-schema'
            ? '按模型能力标记发送格式约束，额外格式约束的实际费用与延迟以供应商为准；仍需本机校验证据。不支持该参数的代理请返回设置改为未知，应用不会自动降级重试。'
            : '未强制启用供应商格式参数。模型及供应商明确支持时，可在模型设置中将结构化输出能力标记为支持。'}
        </p>
        <label>
          <input
            type="checkbox"
            checked={c.retainFailedResponse === true}
            onChange={(e) =>
              match.setConfirmation({ ...c, retainFailedResponse: e.target.checked })
            }
          />
          仅本次JSON失败时保留响应供本机临时查看
        </label>
        <p className="field-hint">
          默认关闭；开启后仅在JSON解析失败时临时保留最多前24000和后8000字符，5分钟自动失效；不写数据库/文件、不上传、不自动重试。可能包含个人资料，已知本次API
          Key会遮蔽，但不是完整脱敏。查看需再次确认；关闭预览、离开匹配页或开始下次匹配即清除。应用不主动落盘，不承诺操作系统换页/崩溃转储不留下痕迹。
        </p>
        <p className="field-hint">
          请求按“任务 → 资料 →
          输出要求”组织；粘贴框为空时仍读取已选附件。固定指令计入输入用量，但不会新增请求，也不保证模型必然遵从。
        </p>
        <details>
          <summary>应用固定匹配指令（随本次发送）</summary>
          <h4>系统输出契约</h4>
          <pre>{matchFormatInstruction(c.outputMode)}</pre>
          <h4>资料前的任务指令</h4>
          <pre>{matchTaskInstruction}</pre>
          <h4>资料后的输出要求</h4>
          <pre>{matchOutputInstruction}</pre>
        </details>
      </ConnectionDetails>
      <div className="modal-footer">
        <button onClick={() => match.setConfirmation(null)}>返回修改</button>
        <button
          className="primary"
          disabled={
            jobReviewSources(c.materials, c.input.job).length > 1 && c.sameJobConfirmed !== true
          }
          onClick={() => void match.run()}
        >
          确认发送并匹配
        </button>
      </div>
    </Modal>
  );
}

function FailedMatchPreview({ runId }: { runId: string }) {
  const viewTicket = useRef(0);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<MatchFailurePreview | null>(null);
  const [used, setUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    return () => {
      viewTicket.current++;
      void window.career!.match.discardFailedPreview(runId).catch(() => {});
    };
  }, [runId]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        setPreview(null);
        setNotice('临时预览已到期并清除。');
      },
      Math.max(0, preview.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);
  const close = () => {
    viewTicket.current++;
    setPreview(null);
    setConfirm(false);
    setUsed(true);
    void window.career!.match.discardFailedPreview(runId).catch(() => {});
  };
  return (
    <div className="material-warning">
      <p>临时响应只供本机定位，未经校验，不是匹配结果。不要复制整个响应给他人。</p>
      {!used && (
        <button className="secondary" onClick={() => setConfirm(true)}>
          查看本次失败响应（仅本机）
        </button>
      )}
      {!used && (
        <button className="secondary" onClick={close}>
          丢弃临时响应
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {confirm && (
        <Modal
          title="确认查看临时响应"
          onClose={() => {
            viewTicket.current++;
            setConfirm(false);
          }}
        >
          <p>
            响应可能含简历、个人资料或供应商返回的敏感文字。查看不会联网或重试，不会保存到历史。仅以纯文本展示，不执行HTML/Markdown。请只反馈“纯文字报告、说明后有JSON、思考标签、拒绝说明”等内容类型，不要粘贴完整正文。
          </p>
          <button onClick={() => setConfirm(false)} disabled={busy}>
            暂不查看
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              const ticket = ++viewTicket.current;
              void window
                .career!.match.takeFailedPreview(runId)
                .then((value) => {
                  if (viewTicket.current !== ticket) return;
                  setConfirm(false);
                  setUsed(true);
                  setPreview(value);
                  if (!value) setNotice('临时响应已清除或到期；无需为查看而反复重发。');
                })
                .catch(() => {
                  if (viewTicket.current !== ticket) return;
                  setNotice('无法读取临时响应；未重发模型请求。');
                  setConfirm(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            我了解，仅在本机查看
          </button>
        </Modal>
      )}
      {preview && (
        <Modal title="本机临时响应（未通过校验）" onClose={close}>
          <p>
            这不是已保存的匹配结果。{preview.truncated ? '内容过长，仅显示前后片段。' : ''}
            最多保留至原5分钟期限；关闭即清除，不提供自动导出/上传。
          </p>
          <textarea
            aria-label="本机临时响应纯文本"
            readOnly
            value={preview.text}
            rows={18}
            spellCheck={false}
          />
          <button onClick={close}>关闭并清除临时响应</button>
        </Modal>
      )}
    </div>
  );
}
