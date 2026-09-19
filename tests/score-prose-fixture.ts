import { SCORE_VALID_BODY } from './score-preview-fixture';
// Entirely synthetic wording; only the observed quote/line structure is reproduced.
export const proseScore = () => {
  const body = JSON.parse(SCORE_VALID_BODY);
  body.dimensions[0].suggestions = [
    '**行动**：将"Built a demo"改为"Built a tested demo"',
    '**说明**：添加描述，例如"Created a sample"',
    '**术语**：将"A & B"改为"C & D"。',
    '**成果**：保留已有转义路径 C:\\demo 与换行\n，不新增事实。',
  ];
  body.dimensions[3].issues = ['存在"A"与"B"两种写法。'];
  return body;
};
export const malformedProseScore = () =>
  '```json\n' + JSON.stringify(proseScore(), null, 2).replaceAll('\\"', '"') + '\n```';
