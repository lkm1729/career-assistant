import { compactProseScore } from './score-prose-compact-fixture';
// Synthetic reproduction of numeric prose plus misplaced null example, no user text.
export const placeholderScore = () => {
  const body = compactProseScore();
  body.dimensions[2].issues.push(
    '时间标注重复：一处为"Mar 2031 - May 2031 | ~12 hrs/week"，另一处使用"2031"作为年份。',
  );
  body.dimensions.push({ key: 'example', value: null });
  return body;
};
export const malformedPlaceholderScore = () =>
  '```json\n' + JSON.stringify(placeholderScore()).replaceAll('\\"', '"') + '\n```';
