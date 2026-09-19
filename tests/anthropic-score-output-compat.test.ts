import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnthropicStream } from '../electron/anthropic';
import { parseScore } from '../electron/scoring';
import { AiError } from '../shared/ai';
import type { MaterialManifest } from '../shared/materials';
const manifest: MaterialManifest = {
  revision: 'test',
  items: [],
  warnings: [],
  imageCount: 0,
  textCount: 0,
};
const response = () => ({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
    key,
    score: key === 'visual' ? null : 80,
    evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'TypeScript' }],
    issues: [],
    suggestions: ['**成果**：补充可核实数字'],
  })),
  summary: 'Synthetic score',
  coveredPages: [],
  unreadablePages: [],
  conflicts: [],
});
const parse = (s: string) => parseScore(s, manifest, 'TypeScript');
const fence = (s: string) => '以下是评分结果：\n```json\n' + s + '\n```\n请参考以上建议。';
test('bounded single JSON fence with short prose is the same validated score', () => {
  const raw = JSON.stringify(response());
  assert.deepEqual(parse(fence(raw)), parse(raw));
});
test('empty signature metadata never blocks a complete text-only score or leaks thinking', () => {
  const raw = JSON.stringify(response());
  let visible = '';
  const parser = new AnthropicStream((t) => (visible += t));
  const feed = (e: Record<string, unknown>) =>
    parser.frame(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of [
    {
      type: 'message_start',
      message: {
        id: 'synthetic',
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: null,
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'PRIVATE-THINKING' },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '' } },
    { type: 'content_block_stop', index: 0 },
  ])
    feed(e);
  assert.equal(parser.result, null);
  assert.equal(visible, '');
  for (const e of [
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: raw } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ])
    feed(e);
  assert.equal(visible, raw);
  assert.equal(parser.result, raw);
  assert.equal(parse(parser.result!).dimensions[0].score, 80);
});
test('JSON failures distinguish safe envelope categories without echoing private output', () => {
  const json = JSON.stringify(response());
  const cases = [
    ['PRIVATE prose only', 'JSON_NOT_DOCUMENT'],
    ['{"PRIVATE":', 'JSON_SYNTAX'],
    ['```json\n' + json, 'JSON_FENCE_COUNT'],
    [fence(json) + '\n```json\n{}\n```', 'JSON_FENCE_COUNT'],
    ['```javascript\n' + json + '\n```', 'JSON_FENCE_FORMAT'],
    ['<PRIVATE>\n' + fence(json), 'JSON_ENVELOPE'],
    ['[PRIVATE]\n' + fence(json), 'JSON_ENVELOPE'],
    [fence('{"PRIVATE":'), 'JSON_SYNTAX'],
    [json + '\nPRIVATE prose', 'JSON_SYNTAX'],
    [json + json, 'JSON_SYNTAX'],
  ];
  for (const [input, reason] of cases)
    assert.throws(
      () => parse(input),
      (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, 'AI_SCORE_JSON');
        assert.ok(e.diagnostic.message.includes(reason), e.diagnostic.message);
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE|TypeScript/);
        return true;
      },
    );
});
test('wrapper tolerance never skips scores, evidence or coverage validation', () => {
  const bad = response();
  bad.dimensions[0].evidence[0].quote = 'PRIVATE-fake-quote';
  assert.throws(
    () => parse(fence(JSON.stringify(bad))),
    (e: unknown) => {
      assert.ok(e instanceof AiError);
      assert.equal(e.diagnostic?.code, 'AI_SCORE_EVIDENCE');
      assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE/);
      return true;
    },
  );
});

test('score envelopes preserve escaped content and reject ambiguous wrappers and nested documents', () => {
  const raw = response();
  raw.summary = 'Escaped "quotes", {braces}, \\paths and ```inline```';
  const json = JSON.stringify(raw);
  for (const input of [
    json,
    '\uFEFF' + json,
    '```JSON\r\n' + json + '\r\n```',
    '```\n' + json + '\n```',
    fence(json),
  ])
    assert.deepEqual(parse(input), parse(json));
  for (const input of [
    'PRIVATE'.repeat(150) + fence(json),
    '{}\n' + fence(json),
    fence(json) + '\n[]',
    '```json\n' + json,
    json + '\n```',
    '```json\n' + json + '\n' + json + '\n```',
    JSON.stringify(json),
    '[' + json + ']',
    fence('null'),
  ])
    assert.throws(() => parse(input), AiError);
});
