import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScoreJson, ScoreJsonSyntaxError } from '../electron/score-json';

test('strict JSON values have identical decoded values, including escapes and prototype-like keys', () => {
  const values: unknown[] = [
    null,
    true,
    false,
    0,
    -0,
    1.5,
    1e20,
    [],
    {},
    '\u0000\b\f\n\r\t\\"中文😀',
    { value: 'https://site.invalid/a//b /* text */ ,} ,] ```' },
    JSON.parse('{"__proto__":{"polluted":true},"constructor":"own"}'),
  ];
  let seed = 8128;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 150; i++)
    values.push({
      n: Math.floor(next() * 20000) - 10000,
      b: next() > 0.5,
      nested: [i, { text: values[i % 10] }],
    });
  for (const v of values) {
    const json = JSON.stringify(v);
    const result = decodeScoreJson(json);
    assert.deepEqual(result.value, JSON.parse(json));
    assert.deepEqual(result.normalized, []);
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('bounded deviations preserve string literals and do not mistake comments or commas inside strings', () => {
  const source = '{/* heading */"text":"http://x//y /*keep*/ ,} ,] ","a":[1,2,/*tail*/],"b":true,}';
  assert.deepEqual(decodeScoreJson(source), {
    value: { text: 'http://x//y /*keep*/ ,} ,] ', a: [1, 2], b: true },
    normalized: ['COMMENTS', 'TRAILING_COMMA'],
  });
  assert.equal((decodeScoreJson('{"s":"A\r\nB\tC"}').value as { s: string }).s, 'A\r\nB\tC');
  assert.equal((decodeScoreJson('{"s":"line\\nline"}').value as { s: string }).s, 'line\nline');
});

for (const [input, reason] of [
  ['{"a":1 "b":2}', 'SEPARATOR_REQUIRED'],
  ['{"a":"PRIVATE "unescaped" words"}', 'SEPARATOR_REQUIRED'],
  ['{"a":1,"a":2}', 'DUPLICATE_KEY'],
  ['{"a":1,"\\u0061":2}', 'DUPLICATE_KEY'],
  ['{"a":}', 'VALUE_REQUIRED'],
  ['{"a" 1}', 'COLON_REQUIRED'],
  ['{a:1}', 'KEY_REQUIRED'],
  ["{'a':1}", 'KEY_REQUIRED'],
  ['{"a":"\\q"}', 'INVALID_ESCAPE'],
  ['{"a":"\\u12gg"}', 'INVALID_ESCAPE'],
  ['{"a":"x\\\ny"}', 'INVALID_ESCAPE'],
  ['{"a":"x\u0000y"}', 'STRING_CONTROL'],
  ['{"a\nb":1}', 'STRING_CONTROL'],
  ['{"a":1,', 'UNCLOSED_CONTAINER'],
  ['[1,,]', 'VALUE_REQUIRED'],
  ['[,1]', 'VALUE_REQUIRED'],
  ['{,"a":1}', 'KEY_REQUIRED'],
  ['{"a":1,,}', 'KEY_REQUIRED'],
  ['{/* PRIVATE', 'UNTERMINATED_COMMENT'],
  ['{"a":1// closes }', 'UNCLOSED_CONTAINER'],
  ['{"n":NaN}', 'UNEXPECTED_TOKEN'],
  ['{"n":1e999}', 'NUMBER_RANGE'],
  ['{"n":01}', 'SEPARATOR_REQUIRED'],
  ['{}{}', 'EXTRA_CONTENT'],
  ['{"a":1]', 'MISMATCHED_CONTAINER'],
  ['['.repeat(65) + '0' + ']'.repeat(65), 'DEPTH_LIMIT'],
  [' '.repeat(700001), 'SIZE_LIMIT'],
] as const)
  test('never guesses malformed JSON: ' + reason + ' / ' + input.length, () => {
    assert.throws(
      () => decodeScoreJson(input),
      (e: unknown) => {
        assert.ok(e instanceof ScoreJsonSyntaxError);
        assert.equal(e.reason, reason);
        assert.doesNotMatch(e.message, /PRIVATE/);
        return true;
      },
    );
  });
