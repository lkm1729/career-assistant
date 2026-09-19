import { HistoricalRunInfo } from './RunInfo';
import { referenceLabels, readableReferences } from '../shared/reference-display';
import { calculateMatchScore, type MatchRecord } from '../shared/matching';
import { visibleMaterialWarnings } from '../shared/material-warnings';

export function MatchSummary({ record: r }: { record: MatchRecord }) {
  const labels = referenceLabels(r.materials, r.sources);
  const text = (value: string) => readableReferences(value, labels);
  // Read-only derivation also supports records saved before this rubric existed.
  const { score, breakdown } = calculateMatchScore(r.requirements);
  const supported = r.requirements.filter((q) => q.status === 'met' || q.status === 'partial');
  const gaps = r.requirements.filter((q) => q.status !== 'met');
  const warnings = visibleMaterialWarnings(r.warnings);
  return (
    <div className="match-summary">
      <div className="match-score-card" aria-label="岗位匹配度分数">
        <div className="match-score-heading">
          <h3>岗位匹配度</h3>
          <strong>
            {score === null ? '—' : score}
            <small>/100</small>
          </strong>
        </div>
        <div
          className="match-score-track"
          role="progressbar"
          aria-label="基于本次材料的岗位匹配度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score ?? undefined}
          aria-valuetext={score === null ? '尚不可计算' : `${score}分，仍需核对证据与硬性条件`}
        >
          <span style={{ width: `${score ?? 0}%` }} />
        </div>
        <p>基于本次简历及补充材料的证据匹配度，不是录用概率或招聘方 ATS 分数。</p>
        <p>
          {breakdown.met} 项已体现 · {breakdown.partial} 项部分体现 · {breakdown.notFound}{' '}
          项未找到证据 · {breakdown.uncertain} 项待确认
        </p>
        {breakdown.hardUnmet.length > 0 && (
          <p className="match-gate">
            <strong>硬性条件尚未全部体现：</strong>
            {breakdown.hardUnmet.join('、')}。分数不代表已满足申请资格。
          </p>
        )}
        <details className="match-rubric">
          <summary>评分规则与证据覆盖</summary>
          <p>
            match-evidence-v1：硬性要求权重2，其他要求权重1；已体现计100%，部分体现计50%，未找到证据和待确认暂不计分，但保留在分母。加权得分除以总权重，四舍五入为百分制。
          </p>
          <p>
            未找到证据不等于没有能力，待确认不等于不符合。仅评价本次提取且通过引用校验的要求，不保证岗位要求已被完整提取；状态和硬性要求由模型辅助识别，仍需人工核对。
          </p>
          <p>
            证据覆盖：{r.coverage === null ? '未计算' : `${r.coverage}%`}
            。覆盖率把已体现和部分体现均视为有证据，不等于匹配度。
          </p>
          {!r.matchScoreVersion && <p>旧记录按当前规则只读展示，未改写历史、未重新调用模型。</p>}
        </details>
        <HistoricalRunInfo record={r} />
      </div>
      <div className="match-guidance-card">
        <section>
          <h3>匹配依据</h3>
          <p>
            <strong>
              {breakdown.hardUnmet.length
                ? '需要补充确认'
                : r.recommendation === 'apply'
                  ? '建议申请'
                  : r.recommendation === 'consider'
                    ? '可以考虑'
                    : r.recommendation === 'not-recommended'
                      ? '暂不建议申请'
                      : '需要补充确认'}
            </strong>
          </p>
          <p>{text(r.summary)}</p>
          <ul>
            {supported.length ? (
              supported.map((q) => (
                <li key={q.id}>
                  <strong>{text(q.requirement)}：</strong>
                  {q.status === 'partial' ? '部分体现。' : '已体现。'}
                  {text(q.note)}
                </li>
              ))
            ) : (
              <li>本次材料尚未提供足够的已核验匹配证据。</li>
            )}
          </ul>
          {r.reasons.length > 0 && (
            <details>
              <summary>模型补充说明</summary>
              <ul>
                {r.reasons.map((v, i) => (
                  <li key={i}>{text(v)}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <section>
          <h3>仍有局限</h3>
          <ul>
            {gaps.length ? (
              gaps.map((q) => (
                <li key={q.id}>
                  <strong>
                    {q.hard ? '硬性条件 · ' : ''}
                    {text(q.requirement)}：
                  </strong>
                  {q.status === 'partial'
                    ? '仅部分体现，需补充更完整证据。'
                    : q.status === 'not-found'
                      ? '未找到可核实经历证据，不表示没有能力。'
                      : '现有信息仍待确认。'}
                  {text(q.note)}
                </li>
              ))
            ) : (
              <li>当前未发现结构化证据缺口；仍应核对岗位完整性与原始材料。</li>
            )}
            {warnings.map((v, i) => (
              <li key={'warning-' + i}>{text(v)}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>申请 / 面试前建议</h3>
          <ul>
            {gaps.map((q) => (
              <li key={q.id}>
                <strong>{text(q.requirement)}：</strong>
                {q.hard
                  ? '申请前核对真实资格及证明材料，不应因总分较高跳过此项。'
                  : q.status === 'uncertain'
                    ? '核对原文或向招聘方确认要求，补充清晰的文字证据。'
                    : '如确有相关经历，补充角色、行动、结果和可核实成果；不要编造。'}
              </li>
            ))}
            <li>
              <strong>面试准备：</strong>
              {supported.length
                ? `围绕“${text(supported[0].requirement)}”准备具体项目案例，说明个人贡献、结果及证据。`
                : '先补充真实经历与岗位对应关系，再准备案例。'}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
