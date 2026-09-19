import type { MaterialManifest, MaterialSheet } from './materials';
import {
  scoreDimensions,
  type ScoreCompleteness,
  type ScoreBlockReason,
  type ScoreDimension,
} from './scoring';

function originalPage(page: MaterialSheet) {
  return !!page.image && (page.source === 'pdf' || page.source === 'image');
}
/** These IDs refer only to original resume images actually included in this send snapshot. */
export function originalResumePageIds(manifest: MaterialManifest): string[] {
  return manifest.items
    .filter((item) => item.purpose === 'resume')
    .flatMap((item) => item.pages.filter(originalPage).map((page) => `${item.id}:p${page.number}`));
}
/** Local input facts, not an inference about what the model will be able to read. */
export function scoreInputCoverage(manifest: MaterialManifest) {
  const resumes = manifest.items.filter((item) => item.purpose === 'resume');
  const pages = resumes.flatMap((item) => item.pages);
  const expectedPages = resumes.reduce((sum, item) => sum + item.totalPages, 0);
  const sentImagePages = originalResumePageIds(manifest).length;
  const reasons: ScoreBlockReason[] = [];
  if (
    resumes.some(
      (item) =>
        !Number.isInteger(item.totalPages) ||
        item.totalPages < 1 ||
        item.totalPages !== item.pages.length ||
        new Set(item.pages.map((p) => p.number)).size !== item.totalPages ||
        item.pages.some(
          (p) => !Number.isInteger(p.number) || p.number < 1 || p.number > item.totalPages,
        ),
    )
  ) {
    reasons.push({
      code: 'RESUME_PAGES_MISSING',
      message: `选中简历的页面不完整：记录共 ${expectedPages} 页，本机保留 ${pages.length} 页，或页码不连续。`,
      action:
        '请预览每份简历，重新导入完整文件；若超过页数上限，请整理为完整的精简版简历，不会自动补齐缺页。',
    });
  }
  const approximate = pages.filter((p) => p.source === 'docx').length;
  if (approximate)
    reasons.push({
      code: 'ORIGINAL_LAYOUT_REQUIRED',
      message: `${approximate} 页是 DOCX 近似预览，不能作为原始版面评价依据。`,
      action: '请将简历另存为 PDF 或提供完整页面截图，用它替换对应的 DOCX 评分资料。',
    });
  const unavailable = pages.filter((p) => p.source !== 'docx' && !originalPage(p)).length;
  if (unavailable || pages.length === 0)
    reasons.push({
      code: 'RESUME_IMAGES_MISSING',
      message: unavailable
        ? `${unavailable} 页简历未发送可用于视觉评价的原始页面图像。`
        : '本次只有简历文字，没有可用于视觉评价的原始简历页面图像。',
      action:
        '请导入 PDF/页面图片并勾选“本次发送页面图像”；若已开启，请检查页面预览是否渲染成功及资料用途是否为简历。',
    });
  return { expectedPages, parsedPages: pages.length, sentImagePages, reasons };
}
/** Called only after source IDs, evidence, page uniqueness and disjoint coverage are validated. */
export function scoreCompleteness(
  manifest: MaterialManifest,
  dimensions: ScoreDimension[],
  coveredPages: string[],
  unreadablePages: string[],
  conflicts: string[],
): ScoreCompleteness {
  const input = scoreInputCoverage(manifest);
  const reasons = [...input.reasons];
  if (unreadablePages.length)
    reasons.push({
      code: 'MODEL_PAGES_UNREADABLE',
      message: `模型报告 ${unreadablePages.length} 页简历图像无法看清。`,
      action:
        '请查看“无法辨识页”和分项意见，补充清晰完整的 PDF/图片；程序不会用其他页面代替这些页。',
    });
  const reported = new Set([...coveredPages, ...unreadablePages]);
  const unreported = originalResumePageIds(manifest).filter((id) => !reported.has(id));
  if (unreported.length)
    reasons.push({
      code: 'MODEL_COVERAGE_MISSING',
      message: `已发送的 ${unreported.length} 页简历图像未被模型列入已看清或无法辨识清单。`,
      action:
        '这不等于原文件残缺。模型未完整报告逐页阅读情况，请核对页面预览后决定是否重新评分；不会自动补记为已读或自动重试。',
    });
  // The missing-image explanation already accounts for an unavailable visual dimension.
  const missingDimensions = scoreDimensions.filter(
    (d) =>
      dimensions.find((value) => value.key === d.key)?.score == null &&
      !(d.key === 'visual' && input.sentImagePages === 0),
  );
  if (missingDimensions.length)
    reasons.push({
      code: 'DIMENSIONS_INCOMPLETE',
      message:
        '模型尚未完成这些维度的评分：' + missingDimensions.map((d) => d.name).join('、') + '。',
      action:
        '请查看相应维度的问题与建议，补充所需依据后再决定是否评分；缺失维度不填零、不重分配权重。',
    });
  if (conflicts.length)
    reasons.push({
      code: 'EVIDENCE_CONFLICT',
      message: `模型报告 ${conflicts.length} 项尚未核实的内容冲突。`,
      action: '请查看评估总结中的冲突说明，核对原文/图像并修正冲突资料后再评分。',
    });
  return {
    ...input,
    policyVersion: 'score-completeness-2',
    modelCoveredPages: coveredPages.length,
    reasons,
  };
}
