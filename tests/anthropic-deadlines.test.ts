import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { streamAnthropic } from '../electron/anthropic';
import { AiError } from '../shared/ai';
const frame = (e: object) => 'data: ' + JSON.stringify(e) + '\n\n';
const start = frame({
  type: 'message_start',
  message: { id: 'test', type: 'message', role: 'assistant', content: [], stop_reason: null },
});
const thinking =
  start +
  frame({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  });
const text =
  start +
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PRIVATE' } });
const ping = frame({ type: 'ping' });
async function local(handler: (res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => handler(res));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('address');
  return {
    endpoint: `http://127.0.0.1:${a.port}/v1/messages`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
const options = {
  modelId: 'fixture',
  apiKey: 'FAKE-KEY',
  messages: [{ role: 'user' as const, content: 'PRIVATE' }],
  signal: new AbortController().signal,
  onText: () => {},
};
for (const [prefix, phase] of [
  ['', 'CONNECTING'],
  [thinking, 'THINKING'],
  [text, 'TEXT'],
])
  test('idle bound reports safe stage ' + phase, async () => {
    const f = await local((res) => {
      if (prefix) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(prefix);
      }
    });
    try {
      await assert.rejects(
        streamAnthropic({ ...options, endpoint: f.endpoint, timeoutMs: 5000, idleTimeoutMs: 500 }),
        (e: unknown) => {
          assert.ok(e instanceof AiError);
          assert.equal(e.diagnostic?.code, 'AI_TIMEOUT');
          assert.match(e.diagnostic.message, /reason=IDLE_LIMIT/);
          assert.ok(e.diagnostic.message.includes('phase=' + phase));
          assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE|FAKE-KEY/);
          return true;
        },
      );
    } finally {
      await f.close();
    }
  });
test('ongoing thinking pings refresh idle bound but still complete only with text/end_turn/message_stop', async () => {
  const f = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(thinking);
    let count = 0;
    const timer = setInterval(() => {
      res.write(ping);
      if (++count === 20) {
        clearInterval(timer);
        res.end(
          [
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'signature_delta', signature: '' },
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'OK' } },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' },
          ]
            .map(frame)
            .join(''),
        );
      }
    }, 40);
    res.on('close', () => clearInterval(timer));
  });
  try {
    assert.equal(
      await streamAnthropic({
        ...options,
        endpoint: f.endpoint,
        timeoutMs: 6000,
        idleTimeoutMs: 600,
      }),
      'OK',
    );
  } finally {
    await f.close();
  }
});
test('heartbeats cannot evade the total deadline', async () => {
  const f = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(thinking);
    const timer = setInterval(() => res.write(ping), 20);
    res.on('close', () => clearInterval(timer));
  });
  try {
    await assert.rejects(
      streamAnthropic({ ...options, endpoint: f.endpoint, timeoutMs: 200, idleTimeoutMs: 1000 }),
      (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, 'AI_TIMEOUT');
        assert.match(e.diagnostic.message, /reason=TOTAL_LIMIT/);
        return true;
      },
    );
  } finally {
    await f.close();
  }
});
test('cancellation wins over deadline handling and invalid idle bounds fail before connection', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    streamAnthropic({
      ...options,
      endpoint: 'http://127.0.0.1:1',
      signal: c.signal,
      timeoutMs: 0,
      idleTimeoutMs: 0,
    }),
    /已取消/,
  );
  for (const idleTimeoutMs of [-1, NaN, Infinity, 2 ** 31])
    await assert.rejects(
      streamAnthropic({ ...options, endpoint: 'http://127.0.0.1:1', idleTimeoutMs }),
      /空闲等待时间无效/,
    );
});
