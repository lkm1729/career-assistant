import { AiError } from './ai';
export interface JobReviewSource {
  id: string;
  name: string;
}
/** Conservative source review, not semantic conflict detection; PDF pages are one source. */
export function jobReviewSources(
  manifest: { items: readonly { id: string; name: string; purpose: string }[] } | null | undefined,
  pasted: string,
): JobReviewSource[] {
  return [
    ...(pasted.trim()
      ? [{ id: 'pasted', name: '本页输入要求 / 岗位文字（请核对是否含另一岗位）' }]
      : []),
    ...(manifest?.items.filter((i) => i.purpose === 'job').map(({ id, name }) => ({ id, name })) ??
      []),
  ];
}
export function assertJobReview(sources: JobReviewSource[], confirmed: unknown) {
  if (
    (confirmed !== undefined && typeof confirmed !== 'boolean') ||
    (sources.length > 1 && confirmed !== true)
  )
    throw new AiError('多份岗位来源尚未确认，请核对同一目标岗位后重新发送。', {
      code: 'MATERIAL_JOB_CONFIRMATION',
      message: '多份岗位来源尚未确认，未调用模型。',
      possibleCauses: ['已选岗位资料与本页输入可能描述不同岗位；应用不会自动判定或合并'],
      solutions: ['返回取消冲突资料或修正岗位文字，再重新确认同一目标岗位；不自动重试'],
    });
}
