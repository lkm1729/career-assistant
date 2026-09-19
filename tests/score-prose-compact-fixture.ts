import { proseScore } from './score-prose-fixture';
// Fictional wording, preserving structural patterns from the new user reports only.
export const compactProseScore = () => {
  const body = proseScore();
  body.dimensions[0].issues = [
    '成果影响不明确，如"several sample plots"的用途。',
    '指标"high accuracy"缺少基准。',
  ];
  body.dimensions[0].suggestions = [
    '**说明**：例如"支持分析章节"',
    '**基准**：补充"相对旧流程的变化"或"与基准对比"',
  ];
  body.dimensions[2].issues = ['底部"Updated Month Year"标注重复。'];
  body.dimensions[2].suggestions = ['**分类**：例如"Tools: Alpha (Beta, Gamma) · Delta"'];
  body.dimensions[3].issues = [
    '"approximately"重复，如"approximately several plots"、"approximately some records"',
  ];
  body.dimensions[3].suggestions = [
    '**表达**：将"Old phrasing"改为"New phrasing"；将"Other phrasing"改为"Better phrasing"',
  ];
  body.dimensions[3].example =
    '**改写示例**：\n原文："Built a sample. Reviewed each output."\n改为："Built and verified a sample."';
  body.summary = '结构完整。短语("independently built and shipped"存在)需要上下文。';
  return body;
};
export const malformedCompactScore = (space?: number) =>
  '```json\n' + JSON.stringify(compactProseScore(), null, space).replaceAll('\\"', '"') + '\n```';
