import { compactProseScore } from './score-prose-compact-fixture';
// Entirely fictional prose/source, with the syntax patterns of the three new reports.
export const BRACKET_SOURCE = 'TypeScript 工作描述包含"Alpha role"和"Beta role"两种定位。';
export const bracketScore = (extra = false) => {
  const body = compactProseScore();
  body.dimensions[0].suggestions.push(
    '**定位**：将"Original role"改为"Produce reports in [sector/technology] with [measured impact]"',
  );
  body.dimensions[0].suggestions.push(
    '**核实**：将"Original claim"改为"Deliver results in [domain] supported by [source]"',
  );
  body.dimensions[1].evidence = [{ sourceId: 'paste', quote: BRACKET_SOURCE }];
  if (extra) body.dimensions.push({ key: 'example', example: null });
  return body;
};
export const malformedBracketScore = (extra = false, space?: number) => {
  let text = JSON.stringify(bracketScore(extra), null, space).replaceAll('\\"', '"');
  // Match mixed escaping: the first phrase is raw, the replacement is already escaped.
  text = text.replace(
    '"Deliver results in [domain] supported by [source]"',
    '\\"Deliver results in [domain] supported by [source]\\"',
  );
  return '```json\n' + text + '\n```';
};
