import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import { decodeScoreJson } from '../electron/score-json';
import { AiError } from '../shared/ai';
import { proseScore } from './score-prose-fixture';
import { compactProseScore, malformedCompactScore } from './score-prose-compact-fixture';
const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
const parse = (text: string) => parseScore(text, manifest, 'TypeScript');
for (const space of [undefined, 0, 1, 2, 4])
  test(`actual new pattern: prose is independent of JSON indentation ${space}`, () => {
    const expected = parse(JSON.stringify(compactProseScore()));
    const actual = parse(malformedCompactScore(space));
    assert.deepEqual({ ...actual, warnings: [] }, { ...expected, warnings: [] });
    assert.ok(actual.warnings.some((w) => w.includes('PROSE_QUOTES')));
  });
for (const field of ['summary', 'example'])
  test(`new report minimized: ${field} alone contains raw quotes`, () => {
    const body = proseScore();
    if (field === 'summary') body.summary = '短语("A"存在)';
    else body.dimensions[3].example = '原文："A"\n改为："B"';
    // Only unescape this field, leaving every other string strictly valid.
    const strict = JSON.stringify(body, null, 2);
    const source = field === 'summary' ? body.summary : body.dimensions[3].example;
    const malformed = strict.replace(
      JSON.stringify(source),
      JSON.stringify(source).replaceAll('\\"', '"'),
    );
    assert.deepEqual({ ...parse(malformed), warnings: [] }, { ...parse(strict), warnings: [] });
  });
test('strict valid JSON with quote-adjacent structure always wins over compatibility', () => {
  const body = compactProseScore();
  body.summary = '"a", "b", {"key":true}, [1] // is literal prose';
  for (const space of [undefined, 2]) {
    const text = JSON.stringify(body, null, space);
    assert.deepEqual(decodeScoreJson(text, { scoreProseQuotes: true }), {
      value: body,
      normalized: [],
    });
  }
});
for (const field of ['quote', 'sourceId', 'key'])
  test('identifier remains strict or evidence must match: ' + field, () => {
    const text = JSON.stringify(compactProseScore()).replace(
      new RegExp('"' + field + '":"[^"\\n]*"'),
      '"' + field + '":"PRIVATE "unsafe" content"',
    );
    assert.throws(
      () => parse(text),
      (e: unknown) =>
        e instanceof AiError &&
        e.diagnostic?.code === (field === 'quote' ? 'AI_SCORE_EVIDENCE' : 'AI_SCORE_JSON'),
    );
  });
for (const bad of [
  '"prefix "a", "b" suffix"',
  '"prefix "key": 1 suffix"',
  '"prefix "[1]" suffix"',
  '"prefix "word" /* comment */ tail"',
  '"first" "second"',
  '"first" 1 "second"',
  '"first "unclosed"',
  '"prefix "" tail"',
  '"prefix "null" tail"',
  '"prefix "word"\n tail"',
])
  test('minified ambiguous summary is rejected: ' + bad, () => {
    const text = JSON.stringify(proseScore()).replace(/"summary":"[^"\n]*"/, '"summary":' + bad);
    assert.throws(
      () => parse(text),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  });
test('normalized compact response still validates evidence and never fills truncated content', () => {
  assert.throws(
    () => parse(malformedCompactScore().replaceAll('TypeScript', 'NOT IN SOURCE')),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_EVIDENCE',
  );
  assert.throws(
    () => parse(malformedCompactScore().slice(0, -20)),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
  );
});

for (const field of ['summary', 'example'])
  test('fallback cannot consume missing separators adjacent to ' + field, () => {
    for (const suffix of ['"next"', '42', 'true', 'false', 'null', '{"next":1}', '[1,2]']) {
      const body = compactProseScore();
      const value = field === 'summary' ? body.summary : body.dimensions[3].example;
      const token = JSON.stringify(value).replaceAll('\\"', '"');
      const malformed = JSON.stringify(body).replace(JSON.stringify(value), token + ' ' + suffix);
      assert.throws(
        () => parse(malformed),
        (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
      );
    }
  });
test('malformed advice never swallows numeric entries, next properties, duplicate keys or unmatched containers', () => {
  for (const [needle, replacement] of [
    ['"suggestions":[', '"suggestions":[42,'],
    ['"summary":', '"summary":"duplicate","summary":'],
    ['"key":"content",', '"key":"content" '],
    ['"example":null', '"example":'],
    ['"coveredPages":[]', '"coveredPages":[}'],
  ]) {
    const source = malformedCompactScore();
    const text = source.replace(needle, replacement);
    assert.notEqual(text, source);
    assert.throws(
      () => parse(text),
      (e: unknown) => e instanceof AiError,
    );
  }
});
test('synthetic compact/pretty prose property sweep preserves mixed escaped and raw paired quotes', () => {
  for (let i = 0; i < 120; i++) {
    const body = compactProseScore();
    body.summary = '概要("Tag ' + i + '"存在)，保留转义符 \\ 和换行\n。';
    body.dimensions[3].example = '原文："Alpha ' + i + '"\n改为："Beta ' + i + '"';
    const strict = JSON.stringify(body, null, i % 5);
    let text = strict;
    for (const value of [body.summary, body.dimensions[3].example]) {
      text = text.replace(JSON.stringify(value), JSON.stringify(value).replaceAll('\\"', '"'));
    }
    assert.deepEqual(decodeScoreJson(text, { scoreProseQuotes: true }).value, body);
  }
});
