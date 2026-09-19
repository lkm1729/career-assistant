import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import { AiError } from '../shared/ai';
import { malformedProseScore, proseScore } from './score-prose-fixture';

const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
const parse = (text: string) => parseScore(text, manifest, 'TypeScript');

test('actual Claude pattern: paired unescaped quotes in line-delimited advice preserve exact strings', () => {
  const expected = parse(JSON.stringify(proseScore()));
  for (const body of [malformedProseScore(), malformedProseScore().replaceAll('\n', '\r\n')]) {
    const actual = parse(body);
    assert.deepEqual({ ...actual, warnings: [] }, { ...expected, warnings: [] });
    assert.ok(actual.warnings.some((w) => w.includes('PROSE_QUOTES')));
  }
});
test('valid escaped advice remains strict and does not produce a compatibility warning', () => {
  assert.equal(
    parse(JSON.stringify(proseScore(), null, 2)).warnings.some((w) => w.includes('PROSE_QUOTES')),
    false,
  );
});
for (const line of [
  '"missing separator" "second item",',
  '"missing separator" 1 "second item",',
  '"prefix "unpaired suffix",',
  '"prefix "quoted", "next" suffix",',
  '"prefix "key": 42 suffix",',
  '"prefix "[[nested]]" suffix",',
  '"prefix "// comment" suffix",',
  '"prefix "word" /*comment*/ suffix",',
  '"prefix "" suffix",',
])
  test('ambiguous prose stays rejected: ' + line, () => {
    const text = JSON.stringify(proseScore(), null, 2).replace(
      /^\s*"\*\*行动\*\*.*$/m,
      '        ' + line,
    );
    assert.throws(
      () => parse(text),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  });
test('bounded prose compatibility cannot bypass evidence validation', () => {
  assert.throws(
    () => parse(malformedProseScore().replaceAll('TypeScript', 'NOT IN SOURCE')),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_EVIDENCE',
  );
});
test('source IDs stay strict and decoded evidence quotes must match source', () => {
  for (const field of ['quote', 'sourceId']) {
    const text = JSON.stringify(proseScore(), null, 2).replace(
      new RegExp('"' + field + '": "[^"\\n]*"'),
      '"' + field + '": "LOCAL "unsafe" text"',
    );
    assert.throws(
      () => parse(text),
      (e: unknown) =>
        e instanceof AiError &&
        e.diagnostic?.code === (field === 'quote' ? 'AI_SCORE_EVIDENCE' : 'AI_SCORE_JSON'),
    );
  }
});

for (const [name, mutate] of [
  ['duplicate field', (s: string) => s.replace('"summary":', '"summary":"duplicate", "summary":')],
  ['missing comma', (s: string) => s.replace('"key": "content",', '"key": "content"')],
  ['truncation', (s: string) => s.slice(0, -15)],
  ['unknown field path', (s: string) => s.replaceAll('"suggestions":', '"other":')],
  ['unclosed multiline advice', (s: string) => s.replace('将"Built', '将\n"Built')],
] as const)
  test('advice normalization keeps invalid structure rejected: ' + name, () => {
    assert.throws(
      () => parse(mutate(malformedProseScore())),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  });

// The generic decoder stays strict; only parseScore enables the advice grammar.
test('prose compatibility is bounded, opt-in and leaves valid escaped strings unchanged', async () => {
  const { decodeScoreJson } = await import('../electron/score-json');
  const unfenced = malformedProseScore()
    .replace(/^```json\n/, '')
    .replace(/\n```$/, '');
  assert.throws(() => decodeScoreJson(unfenced));
  for (const advice of ['x'.repeat(16000) + ' "text"', Array(34).fill('"text"').join(' and ')]) {
    const body = proseScore();
    body.dimensions[0].suggestions = [advice];
    const json = JSON.stringify(body, null, 2).replaceAll('\\"', '"');
    assert.throws(() => decodeScoreJson(json, { scoreProseQuotes: true }));
  }
  for (let i = 0; i < 100; i++) {
    const body = proseScore();
    body.dimensions[0].suggestions = [
      JSON.stringify({ i, text: '"quoted" [data] \\ path \n 中文 😀' }),
    ];
    const json = JSON.stringify(body, null, i % 5);
    assert.deepEqual(decodeScoreJson(json, { scoreProseQuotes: true }), {
      value: JSON.parse(json),
      normalized: [],
    });
  }
});
