import type { JobReviewSource } from '../shared/job-review';
export function JobSourceReview({
  sources,
  confirmed,
  onChange,
}: {
  sources: JobReviewSource[];
  confirmed: boolean;
  onChange: (value: boolean) => void;
}) {
  if (sources.length < 2) return null;
  return (
    <section className="job-source-review" aria-label="多份岗位来源核对">
      <h3>检测到多份岗位输入，请先核对目标</h3>
      <ul>
        {sources.map((s) => (
          <li key={s.id}>{s.name}</li>
        ))}
      </ul>
      <p>
        应用不能自动判定是否同一职位。若包含不同岗位或冲突内容，请返回取消对应资料或修正文字，不要合并发送。
      </p>
      <label>
        <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} />
        我已核对以上资料属于同一目标岗位，已排除冲突内容
      </label>
      <p className="field-hint">仅对本次资料快照有效，不自动沿用到下一次请求。</p>
    </section>
  );
}
