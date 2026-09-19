import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnthropicStream } from '../electron/anthropic';
import { AiError } from '../shared/ai';
type E = Record<string, unknown>;
const start: E = {
  type: 'message_start',
  message: { id: 'PRIVATE-ID', type: 'message', role: 'assistant', content: [], stop_reason: null },
};
const block = (thinking = false): E => ({
  type: 'content_block_start',
  index: 0,
  content_block: thinking ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' },
});
const stop = (index: unknown = 0): E => ({ type: 'content_block_stop', index });
const signature = (value: string): E => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'signature_delta', signature: value },
});
const text: E = {
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: 'SAFE-TEXT' },
};
const end: E[] = [
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];
const feed = (parser: AnthropicStream, events: E[]) =>
  events.forEach((e) => parser.frame(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
const cases: [string, E[], E, string, string][] = [
  ['before message', [], stop(), 'PHASE', 'block=none; index=no-active; signature=not-applicable'],
  [
    'no block',
    [start],
    stop(),
    'NO_ACTIVE_BLOCK',
    'block=none; index=no-active; signature=not-applicable',
  ],
  [
    'duplicate stop',
    [start, block(), stop()],
    stop(),
    'NO_ACTIVE_BLOCK',
    'block=none; index=no-active; signature=not-applicable',
  ],
  [
    'invalid index',
    [start, block()],
    stop('PRIVATE-KEY-INDEX'),
    'INDEX_TYPE',
    'block=text; index=invalid; signature=not-applicable',
  ],
  [
    'wrong index',
    [start, block()],
    stop(1),
    'INDEX_MISMATCH',
    'block=text; index=different; signature=not-applicable',
  ],
  [
    'missing signature',
    [start, block(true)],
    stop(),
    'MISSING_SIGNATURE',
    'block=thinking; index=same; signature=not-started',
  ],
  [
    'signed but wrong index',
    [start, block(true), signature('PRIVATE-SIGNATURE')],
    stop(1),
    'INDEX_MISMATCH',
    'block=thinking; index=different; signature=nonempty',
  ],
  [
    'after end_turn',
    [start, block(), text, stop(), end[0]],
    stop(),
    'PHASE',
    'block=none; index=no-active; signature=not-applicable',
  ],
];
for (const [name, prefix, event, reason, facts] of cases) {
  test(`stop diagnostics: ${name}`, () => {
    const parser = new AnthropicStream(() => {});
    feed(parser, prefix);
    assert.throws(
      () => feed(parser, [event]),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.diagnostic?.code, 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_STOP');
        assert.ok(error.diagnostic.message.includes(`reason=${reason};`), error.diagnostic.message);
        assert.ok(error.diagnostic.message.includes(facts), error.diagnostic.message);
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /PRIVATE|https?:|SAFE-TEXT/);
        assert.equal(parser.result, null);
        return true;
      },
    );
  });
}
test('changing only the stop index repairs a complete text lifecycle', () => {
  const parser = new AnthropicStream(() => {});
  feed(parser, [start, block(), text, stop(0), ...end]);
  assert.equal(parser.result, 'SAFE-TEXT');
});
test('adding a nonempty signature permits stop but never publishes thinking or completes a message', () => {
  let visible = '';
  const parser = new AnthropicStream((t) => (visible += t));
  feed(parser, [
    start,
    block(true),
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'PRIVATE-THINKING' },
    },
    signature(''),
    signature('PRIVATE-SIGNATURE'),
    stop(),
  ]);
  assert.equal(parser.result, null);
  assert.equal(visible, '');
  feed(parser, [
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'SAFE-TEXT' } },
    stop(1),
    ...end,
  ]);
  assert.equal(parser.result, 'SAFE-TEXT');
  assert.equal(visible, 'SAFE-TEXT');
});
