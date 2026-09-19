import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import { decodeScoreJson } from '../electron/score-json';
import { AiError } from '../shared/ai';
import { placeholderScore, malformedPlaceholderScore } from './score-placeholder-fixture';
import { proseScore } from './score-prose-fixture';
const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
const parse = (s: string) => parseScore(s, manifest, 'TypeScript');
test('actual combined pattern: numeric prose and exact null example placeholder preserve all four dimensions', () => {
  const expected = placeholderScore();
  expected.dimensions.pop();
  const actual = parse(malformedPlaceholderScore());
  assert.deepEqual(
    { ...actual, warnings: [] },
    { ...parse(JSON.stringify(expected)), warnings: [] },
  );
  assert.ok(actual.warnings.some((w) => w.includes('PROSE_QUOTES')));
  assert.ok(actual.warnings.some((w) => w.includes('EMPTY_EXAMPLE_PLACEHOLDER')));
});
test('null example placeholder is position independent, but only one exact marker with four unique dimensions is accepted', () => {
  for (let i = 0; i < 5; i++) {
    const b = proseScore();
    b.dimensions.splice(i, 0, { key: 'example', value: null });
    assert.deepEqual(
      parse(JSON.stringify(b)).dimensions,
      parse(JSON.stringify(proseScore())).dimensions,
    );
  }
});
for (const mutate of [
  (b: any) => b.dimensions.splice(0, 1), // missing formal dimension, not a removable extra
  (b: any) => b.dimensions.push({ key: 'example', value: null }),
  (b: any) => {
    b.dimensions[4].value = 'PRIVATE-TEXT';
  },
  (b: any) => {
    b.dimensions[4].score = 99;
  },
  (b: any) => {
    b.dimensions[4].evidence = [];
  },
  (b: any) => {
    delete b.dimensions[4].value;
  },
  (b: any) => {
    b.dimensions[4].key = 'PRIVATE-KEY';
  },
  (b: any) => {
    b.dimensions[1].key = 'content';
  },
  (b: any) => {
    b.dimensions[0] = null;
  },
  (b: any) => {
    b.dimensions = { PRIVATE: 'DATA' };
  },
])
  test(
    'non-placeholder dimension errors remain rejected with safe structural diagnosis ' +
      mutate.toString(),
    () => {
      const b = placeholderScore();
      mutate(b);
      assert.throws(
        () => parse(JSON.stringify(b)),
        (e: unknown) => {
          assert.ok(e instanceof AiError);
          assert.equal(e.diagnostic?.code, 'AI_SCORE_DIMENSIONS');
          assert.match(e.message, /shape=/);
          assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE/);
          return true;
        },
      );
    },
  );
test('source validation remains active after placeholder normalization', () => {
  assert.throws(
    () => parse(malformedPlaceholderScore().replaceAll('TypeScript', 'NOT IN SOURCE')),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_EVIDENCE',
  );
});
for (const value of ['2031', '42', '-3', '1.5', '1e3'])
  test('numeric quote inside contiguous prose is text, not a new JSON value ' + value, () => {
    const b = proseScore();
    b.summary = '正文使用"' + value + '"作为示例。';
    const strict = JSON.stringify(b);
    const malformed = strict.replace(
      JSON.stringify(b.summary),
      JSON.stringify(b.summary).replaceAll('\\"', '"'),
    );
    assert.deepEqual({ ...parse(malformed), warnings: [] }, { ...parse(strict), warnings: [] });
  });
for (const bad of [
  '"prefix "2031" tail"',
  '"first" 2031 "second"',
  '"prefix "null" tail"',
  '"年份"2031", "next"后文"',
])
  test('ambiguous numeric/structural tokens remain rejected ' + bad, () => {
    const text = JSON.stringify(proseScore()).replace(/"summary":"[^"\n]*"/, '"summary":' + bad);
    assert.throws(
      () => parse(text),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  });
test('syntax decoder preserves five original entries; only score layer recognizes the exact marker', () => {
  const b = placeholderScore();
  assert.deepEqual(decodeScoreJson(JSON.stringify(b)).value, b);
});
