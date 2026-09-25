import { MaterialPreview } from './Materials';
import { ActionFeedback } from './ActionFeedback';
import { BulkHistory } from './BulkHistory';
import { DiagnosticPanel } from './DiagnosticPanel';
import { HistoricalRunInfo } from './RunInfo';
import { ResultHeader } from './ResultHeader';
import { useState } from 'react';
import type { InterviewState } from './useInterview';
import { Modal } from './Modal';
import { JobSourceReview } from './JobSourceReview';
import { jobReviewSources } from '../shared/job-review';
export function InterviewPanel({ interview }: { interview: InterviewState }) {
  const record = interview.current;
  const pending = interview.busy || interview.preparing;
  return (
    <section
      className={`card evaluation-panel ai-result-panel interview-result-panel${pending ? ' interview-generating' : ''}`}
      aria-label="面试问答 AI 回答区"
    >
      <ResultHeader
        title="英文模拟面试问答"
        pending={pending}
        status={
          interview.busy
            ? record
              ? '正在生成 · 下方保留已保存问答'
              : '正在生成 · 尚未保存'
            : interview.preparing
              ? '准备发送确认'
              : record
                ? interview.records[0]?.id === record.id
                  ? '已保存本次问答'
                  : '历史问答 · 已恢复显示'
                : '尚未生成'
        }
      />
      {interview.error && <DiagnosticPanel diagnostic={interview.error} />}
      {pending && (
        <ActionFeedback
          label="面试问答生成状态"
          pending
          announce={false}
          message={
            interview.busy
              ? '正在生成20组中英双语问题与参考答案，完整校验后才会保存…'
              : '正在保存草稿并准备发送确认…'
          }
          onCancel={interview.busy ? () => void interview.cancel() : undefined}
          cancelLabel="停止本次生成"
        />
      )}
      {interview.message && !pending && (
        <p className="action-feedback-message" role="status">
          {interview.message}
        </p>
      )}
      {record ? (
        <InterviewResultView record={record} />
      ) : (
        !pending && <p className="interview-empty">填写岗位与简历，选择本页资料后生成问答。</p>
      )}
      <InterviewHistory interview={interview} />
    </section>
  );
}
function InterviewResultView({ record }: { record: NonNullable<InterviewState['current']> }) {
  return (
    <div className="interview-pairs">
      <HistoricalRunInfo record={record} kind="生成" />
      {record.pairs.map((pair, index) => (
        <article key={index} className="interview-pair">
          <h3 className="interview-question">
            Q{index + 1}. {pair.question}
          </h3>
          {pair.questionZh && (
            <p className="interview-question-translation">
              Q{index + 1}：{pair.questionZh}
            </p>
          )}
          <p className="interview-answer">
            <strong>A{index + 1}.</strong> {pair.answer}
          </p>
          {pair.answerZh && (
            <p className="interview-answer-translation">
              A{index + 1}：{pair.answerZh}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
export function InterviewConfirmationDialog({ interview }: { interview: InterviewState }) {
  const c = interview.confirmation;
  if (!c) return null;
  return <InterviewConfirmationBody key={c.runId} interview={interview} c={c} />;
}
function InterviewConfirmationBody({
  interview,
  c,
}: {
  interview: InterviewState;
  c: NonNullable<InterviewState['confirmation']>;
}) {
  const [sameJob, setSameJob] = useState(false);
  const jobs = jobReviewSources(c.materials, c.input.job);
  return (
    <Modal title="确认发送面试资料" onClose={() => interview.setConfirmation(null)}>
      <p>
        仅向 {c.connection.providerName} / {c.connection.modelName}{' '}
        发送本页岗位、简历、补充文字、系统提示词及下面已选资料。生成约20组英文问答。
      </p>
      <p>
        岗位文字：{c.input.job.length} 字符；简历文字：{c.input.resume.length} 字符；补充文字：
        {c.input.evidence.length} 字符；提示词：{c.input.systemPrompt.length} 字符。
      </p>
      <p>
        已选 {c.materials.items.length} 项资料 ·{' '}
        {c.sendImages ? `含 ${c.materials.imageCount} 张图片` : '不发送图片'}。
      </p>
      <ul>
        {c.materials.items.map((item) => (
          <li key={item.id}>
            {item.name}（{item.purpose}）
          </li>
        ))}
      </ul>
      {c.materials.items.map((item) => (
        <details key={item.id} className="material-send-preview">
          <summary>核对选中资料：{item.name}</summary>
          <MaterialPreview item={item} />
        </details>
      ))}
      {c.materials.warnings.map((warning, i) => (
        <p key={i} className="material-warning">
          {warning}
        </p>
      ))}
      <JobSourceReview sources={jobs} confirmed={sameJob} onChange={setSameJob} />
      <div className="modal-footer">
        <button type="button" className="secondary" onClick={() => interview.setConfirmation(null)}>
          返回修改
        </button>
        <button
          type="button"
          className="primary"
          disabled={jobs.length > 1 && !sameJob}
          onClick={() => {
            c.sameJobConfirmed = sameJob;
            void interview.run();
          }}
        >
          确认发送并生成
        </button>
      </div>
    </Modal>
  );
}
export function InterviewHistory({ interview }: { interview: InterviewState }) {
  return (
    <details className="score-history interview-history">
      <summary className="assessment-history-toggle">
        <span>问答生成历史 · {interview.records.length} 条</span>
        <span className="history-toggle-hint">展开 / 收起记录</span>
      </summary>
      {interview.error && <DiagnosticPanel diagnostic={interview.error} />}
      <BulkHistory
        items={interview.records}
        identity={(record) => record.id}
        label="问答历史"
        disabled={interview.selectionDisabled}
        revision={interview.revision}
        impact="仅删除本页问答历史列表记录；当前显示结果、清空撤销备份、输入资料、原始材料和其他标签页保持不变。"
        remove={(items, revision) =>
          interview.deleteMany(
            items.map((record) => record.id),
            revision,
          )
        }
        render={(record) => (
          <button
            className="secondary"
            disabled={interview.selectionDisabled}
            onClick={() => void interview.select(record)}
          >
            {new Date(record.createdAt).toLocaleString()} · {record.pairs.length} 组中英问答 ·
            恢复显示
          </button>
        )}
      />
    </details>
  );
}
