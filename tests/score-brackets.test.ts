import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScoreJson } from '../electron/score-json';
import { parseScore } from '../electron/scoring';
import { AiError } from '../shared/ai';
import { proseScore } from './score-prose-fixture';
import { BRACKET_SOURCE, bracketScore, malformedBracketScore } from './score-bracket-fixture';
const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
const parse = (s: string, pasted = BRACKET_SOURCE) => parseScore(s, manifest, pasted);
for (const extra of [false, true])
  for (const space of [undefined, 2])
    test(`new report combined bracket/mixed evidence/empty marker extra=${extra} space=${space}`, () => {
      const expected = bracketScore();
      const actual = parse(malformedBracketScore(extra, space));
      assert.deepEqual(
        { ...actual, warnings: [] },
        { ...parse(JSON.stringify(expected)), warnings: [] },
      );
      assert.ok(actual.warnings.some((w) => w.includes('PROSE_QUOTES')));
      assert.equal(
        actual.warnings.some((w) => w.includes('EMPTY_EXAMPLE_PLACEHOLDER')),
        extra,
      );
    });
for (const field of ['suggestions', 'example', 'summary', 'quote'] as const)
  test('text placeholder quotes preserve content in ' + field, () => {
    const body = proseScore(),
      text = '文字"Value in [target/area] and [measured result]"说明';
    if (field === 'suggestions') body.dimensions[0].suggestions = [text];
    else if (field === 'example') body.dimensions[0].example = text;
    else if (field === 'summary') body.summary = text;
    else body.dimensions[0].evidence[0].quote = text;
    const strict = JSON.stringify(body),
      malformed = strict.replace(JSON.stringify(text), JSON.stringify(text).replaceAll('\\"', '"'));
    const source = 'TypeScript ' + text;
    assert.deepEqual(
      { ...parse(malformed, source), warnings: [] },
      { ...parse(strict, source), warnings: [] },
    );
  });
for (const value of [null, 'PRIVATE CONTENT', {}, [], 42])
  test(
    'example null alias accepts only null, never loses meaningful content ' + typeof value,
    () => {
      const body = proseScore();
      body.dimensions.push({ key: 'example', example: value });
      if (value === null)
        assert.deepEqual(
          parse(JSON.stringify(body)).dimensions,
          parse(JSON.stringify(proseScore())).dimensions,
        );
      else
        assert.throws(
          () => parse(JSON.stringify(body)),
          (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_DIMENSIONS',
        );
    },
  );
for (const marker of [
  { key: 'example', example: null, value: null },
  { key: 'example', example: null, score: null },
  { key: 'example', example: null, evidence: [] },
  { key: 'example' },
  { key: 'PRIVATE', example: null },
])
  test('marker with other fields remains rejected ' + Object.keys(marker).join(','), () => {
    const body = proseScore();
    body.dimensions.push(marker);
    assert.throws(
      () => parse(JSON.stringify(body)),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_DIMENSIONS',
    );
  });
for (const bad of [
  '[1]',
  '[true]',
  '[false]',
  '[null]',
  '[1,2]',
  '["key"]',
  '[{"x":1}]',
  '[[text]]',
  '[missing',
  '[target: value]',
])
  test('do not swallow JSON-shaped brackets ' + bad, () => {
    const body = proseScore();
    body.summary = '前文"' + bad + '"后文';
    assert.throws(
      () =>
        parse(
          JSON.stringify(body).replace(
            JSON.stringify(body.summary),
            JSON.stringify(body.summary).replaceAll('\\"', '"'),
          ),
        ),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  });
test('unescaped evidence string still must match an actual provided source', () => {
  assert.throws(
    () => parse(malformedBracketScore(), 'TypeScript'),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_EVIDENCE',
  );
  const changed = malformedBracketScore().replaceAll(
    '"sourceId":"paste"',
    '"sourceId":"PRIVATE-SOURCE"',
  );
  assert.throws(
    () => parse(changed),
    (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_EVIDENCE',
  );
});
test('source ID and key are never interpreted as prose', () => {
  for (const field of ['sourceId', 'key']) {
    const bad = JSON.stringify(bracketScore()).replace(
      new RegExp('"' + field + '":"[^"\\n]*"'),
      '"' + field + '":"PRIVATE "unsafe" ID"',
    );
    assert.throws(
      () => parse(bad),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  }
});
test('strict valid bracket/quote/JSON-like text is never reinterpreted', () => {
  const body = bracketScore();
  body.summary = '"A", [1,true,null], {"x":1}, [target]';
  const strict = JSON.stringify(body, null, 2);
  assert.deepEqual(decodeScoreJson(strict, { scoreProseQuotes: true }), {
    value: body,
    normalized: [],
  });
});

test('generated field/spacing/mixed-escape sweep preserves literal placeholders and evidence', () => {
  for (let i = 0; i < 100; i++) {
    const body = bracketScore();
    body.summary = '说明"Report ' + i + ' in [target area ' + i + ']"正文';
    body.dimensions[1].evidence[0].quote = 'TypeScript 原文"Quoted ' + i + ' [area]"保持';
    const strict = JSON.stringify(body, null, i % 5);
    let malformed = strict;
    for (const text of [body.summary, body.dimensions[1].evidence[0].quote])
      malformed = malformed.replace(
        JSON.stringify(text),
        JSON.stringify(text).replaceAll('\\"', '"'),
      );
    assert.deepEqual(decodeScoreJson(malformed, { scoreProseQuotes: true }).value, body);
    const source = body.dimensions[1].evidence[0].quote;
    assert.deepEqual(
      { ...parse(malformed, source), warnings: [] },
      { ...parse(strict, source), warnings: [] },
    );
  }
});
test('compatibility never swallows a missing separator after an evidence quote', () => {
  for (const tail of [' "second"', ' 42', ' true', ' {"extra":1}', ' [1,2]']) {
    const body = bracketScore();
    const q = body.dimensions[1].evidence[0].quote;
    const bad = JSON.stringify(body).replace(
      JSON.stringify(q),
      JSON.stringify(q).replaceAll('\\"', '"') + tail,
    );
    assert.throws(
      () => parse(bad),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  }
});
test('bounded placeholders reject overlong, newline, unclosed or unquoted-context tokens', () => {
  for (const text of [
    '前文"[' + 'x'.repeat(161) + ']"后文',
    '前文"[target\narea]"后文',
    '前文"[target"后文',
    '前文[target]与"quoted"后文',
  ]) {
    const body = proseScore();
    body.summary = text;
    const bad = JSON.stringify(body).replace(
      JSON.stringify(text),
      JSON.stringify(text).replaceAll('\\"', '"'),
    );
    assert.throws(
      () => parse(bad),
      (e: unknown) => e instanceof AiError && e.diagnostic?.code === 'AI_SCORE_JSON',
    );
  }
});
