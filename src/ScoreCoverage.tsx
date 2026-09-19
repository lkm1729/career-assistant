import type { ScoreBlockReason, ScoreConfirmation, ScoreResult } from '../shared/scoring';
import { scoreInputCoverage } from '../shared/score-completeness';
function Reasons({ reasons }: { reasons: ScoreBlockReason[] }) {
  return (
    <ul>
      {reasons.map((reason) => (
        <li key={reason.code}>
          <strong>{reason.message}</strong>
          <p>{reason.action}</p>
        </li>
      ))}
    </ul>
  );
}
export function ScoreInputCheck({ confirmation }: { confirmation: ScoreConfirmation }) {
  const coverage = scoreInputCoverage(confirmation.materials);
  return (
    <section className="score-coverage" aria-label="评分前完整性检查">
      <h3>评分前完整性检查</h3>
      {coverage.expectedPages > 0 && (
        <p>
          本次所选简历：本机解析 {coverage.parsedPages}/{coverage.expectedPages}{' '}
          页；将发送原始页面图像 {coverage.sentImagePages} 页。
        </p>
      )}
      {!confirmation.sendImages && <p>本次关闭了页面图像发送，只能获得文字分项评价。</p>}
      {coverage.reasons.length ? (
        <>
          <p>以下情况会限制完整总分；你可以返回补充，也可以继续获取部分评价。</p>
          <Reasons reasons={coverage.reasons} />
        </>
      ) : (
        <p>
          本机页面准备完整。最终是否计算总分，还取决于模型逐页看清并完成四维评价；不会补造分数。
        </p>
      )}
    </section>
  );
}
export function ScoreCoverage({ result }: { result: ScoreResult }) {
  const coverage = result.completeness;
  if (!coverage)
    return result.total === null ? (
      <section className="score-coverage" aria-label="评分完整性">
        <h3>历史部分评价</h3>
        <p>这条旧记录未保存详细的完整性检查，仍保留当时的分数和提示，不会自动重算。</p>
      </section>
    ) : null;
  return (
    <section className="score-coverage" aria-label="评分完整性">
      <h3>{result.total === null ? '暂未计算总分的原因' : '完整评价条件已满足'}</h3>
      {coverage.expectedPages > 0 && (
        <p>
          本机解析 {coverage.parsedPages}/{coverage.expectedPages} 页 · 已发送原始图像{' '}
          {coverage.sentImagePages} 页 · 模型确认看清 {coverage.modelCoveredPages} 页
        </p>
      )}
      {coverage.reasons.length ? (
        <Reasons reasons={coverage.reasons} />
      ) : (
        <p>
          仅依据本次选中的简历和参考资料评分，四维权重保持 30/30/20/20。未选资料不会阻止本次总分。
        </p>
      )}
    </section>
  );
}
