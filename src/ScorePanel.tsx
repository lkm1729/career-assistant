import { ScoreFailedPreview } from './ScoreFailedPreview';
import { ConfirmationIntro, ConnectionDetails, Disclosure, HistoricalRunInfo } from './RunInfo';
import { BulkHistory } from './BulkHistory';
import { referenceLabels, referenceLabel, readableReferences } from '../shared/reference-display';
import { EvidenceQuote } from './EvidenceQuote';
import { ResultHeader } from './ResultHeader';
import { ScoreCoverage, ScoreInputCheck } from './ScoreCoverage';
import { jobReviewSources } from '../shared/job-review';
import { JobSourceReview } from './JobSourceReview';
import { AssessmentWaitNotice } from './AssessmentWaitNotice';
import { AdviceList, AdviceText } from './Advice';
import { visibleMaterialWarnings } from '../shared/material-warnings';
import { ActionFeedback } from './ActionFeedback';
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import { DiagnosticPanel } from './DiagnosticPanel';
import { MaterialSendPreview } from './Materials';
import { scoreDimensions, scoreMode, type ScoreRecord } from '../shared/scoring';
import type { ScoreState } from './useScore';
export function ScoreResultView({ record }: { record: ScoreRecord }) {
  const [selected, setSelected] = useState(0);
  const d = record.dimensions[selected];
  const labels = referenceLabels(record.sources);
  const explained = new Set(record.completeness?.reasons.map((reason) => reason.message) ?? []);
  return (
    <>
      <div className="score-overview">
        <div>
          <span>{record.total === null ? '部分评价 · 不计算完整总分' : '综合评分'}</span>
          <div className="score-number">
            {record.total ?? '—'}
            <span>/100</span>
          </div>
        </div>
        <div className="score-explanation">
          <div className="score-track">
            <div
              style={{
                width: `${record.total ?? 0}%`,
                height: '100%',
                background: 'var(--accent)',
              }}
            />
          </div>
          <p>
            {record.mode === 'targeted' ? '目标岗位模式' : '通用职业定位模式'} ·{' '}
            {record.rubricVersion}
          </p>
          <p>模型辅助评价，不代表招聘方 ATS 分数或录用概率。</p>
          <HistoricalRunInfo record={record} />
        </div>
      </div>
      <ScoreCoverage result={record} />
      {visibleMaterialWarnings(record.warnings)
        .filter((w) => !explained.has(w))
        .map((w, i) => (
          <p className="material-warning" key={i}>
            {readableReferences(w, labels)}
          </p>
        ))}
      <div className="dimension-grid" role="group" aria-label="评分维度">
        {scoreDimensions.map((v, i) => (
          <button key={v.key} aria-pressed={selected === i} onClick={() => setSelected(i)}>
            <span>
              {v.name} · {v.weight}%
            </span>
            <strong>{record.dimensions[i].score ?? '未评价'}</strong>
            <small>展开依据与建议</small>
          </button>
        ))}
      </div>
      <div className="dimension-description">
        <h3>{scoreDimensions[selected].name}</h3>
        <h4>证据与定位</h4>
        {d.evidence.length ? (
          d.evidence.map((e, i) => (
            <EvidenceQuote key={i} sourceId={e.sourceId} quote={e.quote} labels={labels} />
          ))
        ) : (
          <p>资料不足，未提供可核对证据。</p>
        )}
        <h4>问题</h4>
        <AdviceList items={d.issues} labels={labels} />
        <h4>建议</h4>
        <AdviceList items={d.suggestions} labels={labels} />
        {d.example && (
          <>
            <h4>修改示例（须核对事实）</h4>
            <AdviceText text={d.example} listFallback={false} labels={labels} />
          </>
        )}
      </div>
      <div className="summary-block">
        <h3>评估总结</h3>
        <AdviceText text={record.summary} labels={labels} />
        <p>
          已评价图像页：
          {record.coveredPages.map((id) => referenceLabel(id, labels)).join('、') || '无'}
          ；无法辨识页：
          {record.unreadablePages.map((id) => referenceLabel(id, labels)).join('、') || '无报告'}
        </p>
        {record.conflicts.map((v, i) => (
          <p className="material-warning" key={i}>
            文字与视觉冲突：{readableReferences(v, labels)}
          </p>
        ))}
      </div>
    </>
  );
}
function ScoreEmptyView() {
  const [selected, setSelected] = useState(0);
  return (
    <>
      <div className="score-overview">
        <div>
          <span>尚未完成评价</span>
          <div className="score-number">
            —<span>/100</span>
          </div>
        </div>
        <div className="score-explanation">
          <p>完成评分后显示程序计算的四维结果。</p>
        </div>
      </div>
      <div className="dimension-grid" role="group" aria-label="评分维度">
        {scoreDimensions.map((v, i) => (
          <button key={v.key} aria-pressed={selected === i} onClick={() => setSelected(i)}>
            <span>
              {v.name} · {v.weight}%
            </span>
            <strong>未评价</strong>
            <small>展开依据与建议</small>
          </button>
        ))}
      </div>
      <div className="dimension-description">
        <h3>{scoreDimensions[selected].name}</h3>
        <p>需要实际页面图像或完成一次评分后才能评价；不会把缺失资料当作零分。</p>
      </div>
    </>
  );
}

export function ScorePanel({ score }: { score: ScoreState }) {
  return (
    <section className="card evaluation-panel ai-result-panel" aria-label="简历评分 AI 回答区">
      <ResultHeader
        title="简历评分"
        pending={score.busy || score.preparing}
        status={
          score.busy
            ? score.current
              ? '正在评分 · 下方保留已保存结果'
              : '正在评分 · 尚未保存'
            : score.preparing
              ? '准备发送确认'
              : score.current
                ? score.records[0]?.id === score.current.id
                  ? '已保存独立评估'
                  : '历史评估 · 已恢复显示'
                : '尚未评估'
        }
      />
      {score.error && <DiagnosticPanel diagnostic={score.error} />}{' '}
      {score.previewRunId && (
        <ScoreFailedPreview key={score.previewRunId} runId={score.previewRunId} />
      )}
      {score.busy && (
        <ActionFeedback
          label="评分运行概况"
          pending
          announce={false}
          message={
            score.cancelling ? '正在请求停止评分…' : '正在按四维量表评分，完整结果校验后才会保存…'
          }
          cancelling={score.cancelling}
          onCancel={() => void score.cancel()}
          cancelLabel="取消评分"
        />
      )}
      {score.current ? (
        <ScoreResultView key={score.current.id} record={score.current} />
      ) : (
        <ScoreEmptyView />
      )}
      <ScoreHistory score={score} />
    </section>
  );
}
export function ScoreHistory({ score }: { score: ScoreState }) {
  return (
    <details className="score-history">
      <summary className="assessment-history-toggle">
        <span>独立评估历史 · {score.records.length} 条</span>
        <span className="history-toggle-hint">展开 / 收起记录</span>
      </summary>
      {score.error && <DiagnosticPanel diagnostic={score.error} />}
      <BulkHistory
        items={score.records}
        identity={(r) => r.id}
        label="评估历史"
        disabled={score.selectionDisabled}
        revision={score.historyRevision}
        impact="仅删除历史列表记录；当前工作台结果、清空撤销备份、输入正文、原始资料和其他标签页保持不变。当前结果作为本地副本保留；如需移除显示，请单独清空工作台。"
        remove={(items, revision) =>
          score.deleteMany(
            items.map((r) => r.id),
            revision,
          )
        }
        render={(r) => (
          <>
            <button
              className="secondary"
              disabled={score.selectionDisabled}
              onClick={() => void score.setCurrent(r)}
            >
              {new Date(r.createdAt).toLocaleString()} ·{' '}
              {r.total === null ? '部分评价' : r.total + '分'} · {r.connection.modelName}
            </button>
            <details>
              <summary>查看当时完整评估与输入快照</summary>
              <ScoreResultView record={r} />
              <h4>当时目标与正文</h4>
              <pre>
                {r.input.prompt}
                {'\n'}
                {r.input.document}
              </pre>
              <details>
                <summary>来源快照（图像按引用记录）</summary>
                <pre>{JSON.stringify(r.sources, null, 2)}</pre>
              </details>
            </details>
          </>
        )}
      />
    </details>
  );
}
export function ScoreConfirmationDialog({ score }: { score: ScoreState }) {
  const c = score.confirmation;
  if (!c) return null;
  return (
    <Modal title="确认本次简历评分" onClose={() => score.setConfirmation(null)}>
      <ConfirmationIntro
        operation={scoreMode(c) === 'targeted' ? '按目标岗位评分' : '通用简历评分'}
        connection={c.connection}
        materials={c.materials}
        input={c.input}
      />
      <JobSourceReview
        sources={jobReviewSources(c.materials, c.input.prompt)}
        confirmed={c.sameJobConfirmed === true}
        onChange={(sameJobConfirmed) => score.setConfirmation({ ...c, sameJobConfirmed })}
      />
      <ScoreInputCheck confirmation={c} />
      <Disclosure title="查看本次发送内容">
        {Object.entries(c.input).map(([k, v]) => (
          <details key={k}>
            <summary>
              {k === 'prompt'
                ? '目标岗位文字（也可使用所选岗位资料）'
                : k === 'document'
                  ? '简历文字'
                  : '系统提示词'}
            </summary>
            <pre>{v || '（空）'}</pre>
          </details>
        ))}
        <MaterialSendPreview manifest={c.materials} />
      </Disclosure>
      <ConnectionDetails connection={c.connection}>
        <p>程序附加四维 JSON 格式要求，不执行资料中的指令。评分不代表录用概率。</p>
        <p>
          参数：{JSON.stringify(c.connection.parameters)} · 模式：
          {scoreMode(c) === 'targeted' ? '目标岗位' : '通用'}
          {' · 输出：'}
          {c.outputMode === 'gemini-json-schema'
            ? 'Gemini 原生 JSON Schema 约束'
            : c.outputMode === 'anthropic-json-schema'
              ? 'Anthropic 原生 JSON Schema 约束'
              : '提示词 JSON（兼容模式）'}
        </p>
        {c.connection.protocol === 'anthropic' && (
          <>
            <AssessmentWaitNotice />
            <p>
              本次使用短来源编号，保存时还原为原资料。若供应商不支持原生 JSON
              Schema，请明确修改模型能力后重新确认；不会自动重试。
            </p>
          </>
        )}
      </ConnectionDetails>
      <section className="confirm-inline" aria-label="本次评分临时诊断选项">
        <label>
          <input
            type="checkbox"
            checked={c.retainFailedResponse === true}
            onChange={(event) =>
              score.setConfirmation({ ...c, retainFailedResponse: event.target.checked })
            }
          />
          仅本次评分JSON或维度校验失败时保留响应供本机诊断
        </label>
        <p className="field-hint">
          默认关闭，每次需单独勾选；只有返回正文未通过JSON解析或四维结构校验时才临时保留，最多700000字符、5分钟自动清除。不写数据库或文件、不自动外传、不自动重试。可能含个人资料，已知本次API
          Key会遮蔽，但不是完整脱敏。查看需再次确认，关闭预览、离开评分页或下次评分会清除；手动复制的系统剪贴板不会自动清除。
        </p>
      </section>
      <div className="modal-footer">
        <button className="secondary" onClick={() => score.setConfirmation(null)}>
          返回修改
        </button>
        <button
          className="primary"
          disabled={
            jobReviewSources(c.materials, c.input.prompt).length > 1 && c.sameJobConfirmed !== true
          }
          onClick={() => void score.run()}
        >
          确认发送并评分
        </button>
      </div>
    </Modal>
  );
}
