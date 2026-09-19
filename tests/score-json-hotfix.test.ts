import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import { AiError } from '../shared/ai';
const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
const raw = () => ({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
    key,
    score: key === 'visual' ? null : 80,
    evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'TypeScript' }],
    issues: [],
    suggestions: ['**成果**：补充量化证据'],
  })),
  summary: 'Line one\nLine two\tIndented\rReturn',
  coveredPages: [],
  unreadablePages: [],
  conflicts: [],
});
const fence = (text: string) => '```json\n' + text + '\n```';
const parse = (text: string) => parseScore(text, manifest, 'TypeScript');
for (const [name, mutate] of [
  ['TRAILING_COMMA', (s: string) => s.slice(0, -1) + ',}'],
  [
    'STRING_CONTROLS',
    (s: string) => s.replaceAll('\\n', '\n').replaceAll('\\t', '\t').replaceAll('\\r', '\r'),
  ],
  ['COMMENTS', (s: string) => s.replace('{', '{ /* PRIVATE COMMENT */\n')],
] as const)
  test('complete score tolerates presentation only: ' + name, () => {
    const json = JSON.stringify(raw());
    const result = parse(fence(mutate(json)));
    const expected = parse(json);
    assert.deepEqual({ ...result, warnings: [] }, { ...expected, warnings: [] });
    assert.ok(result.warnings.some((w) => w.includes('JSON') && w.includes(name)));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE COMMENT/);
  });
test('all safe presentation deviations combined preserve the exact decoded score', () => {
  const json = JSON.stringify(raw())
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\r', '\r');
  const input = '// comment\n' + json.slice(0, -1) + ', // comment\n}';
  const actual = parse(fence(input)),
    expected = parse(JSON.stringify(raw()));
  assert.deepEqual({ ...actual, warnings: [] }, { ...expected, warnings: [] });
});
test('syntax compatibility never skips evidence validation or guesses missing values', () => {
  const invalid = raw();
  invalid.dimensions[3].evidence[0].sourceId = 'PRIVATE-NOT-SENT';
  assert.throws(
    () => parse(fence(JSON.stringify(invalid).slice(0, -1) + ',}')),
    (e: unknown) => {
      assert.ok(e instanceof AiError);
      assert.equal(e.diagnostic?.code, 'AI_SCORE_EVIDENCE');
      assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE-NOT-SENT/);
      return true;
    },
  );
});
