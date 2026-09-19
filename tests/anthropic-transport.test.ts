import { createServer as createNetServer, type Socket } from 'node:net';
import { publicAiDiagnostic } from '../electron/ai-service';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Agent, fetch } from 'undici';
import { streamAnthropic } from '../electron/anthropic';

// Pinned Undici's own test clock: advances only the transport timers, not the
// application's finite total/idle clocks. No production code uses these internals.
const require = createRequire(import.meta.url);
const clock = require('undici/lib/util/timers.js') as { tick(ms?: number): void; reset(): void };
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
const start = [
  {
    type: 'message_start',
    message: { id: 'test', type: 'message', role: 'assistant', content: [], stop_reason: null },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
]
  .map(frame)
  .join('');
const stop = [
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
]
  .map(frame)
  .join('');
async function local() {
  const received = Promise.withResolvers<ServerResponse>();
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => received.resolve(res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/messages`,
    received: received.promise,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clock.reset();
    },
  };
}
for (const phase of ['headers', 'body'] as const) {
  test(`control: default transport's five-minute ${phase} timeout can preempt application waiting`, async () => {
    const f = await local();
    const dispatcher = new Agent();
    try {
      const reading = Promise.withResolvers<void>();
      const result = fetch(f.endpoint, { dispatcher, signal: AbortSignal.timeout(10_000) }).then(
        async (r) => {
          const reader = r.body!.getReader();
          await reader.read();
          reading.resolve();
          await reader.read();
        },
      );
      const failed = assert.rejects(result, (error: unknown) => {
        const cause = (error as { cause?: { code?: string } }).cause;
        assert.equal(
          cause?.code,
          phase === 'headers' ? 'UND_ERR_HEADERS_TIMEOUT' : 'UND_ERR_BODY_TIMEOUT',
        );
        return true;
      });
      const response = await f.received;
      if (phase === 'body') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(start);
        await reading.promise;
      }
      await nextTurn();
      clock.tick();
      clock.tick(360_000);
      await failed;
    } finally {
      await dispatcher.destroy();
      await f.close();
    }
  });
  test(`native stream survives six transport-clock minutes awaiting ${phase}, with application bounds intact`, async () => {
    const f = await local();
    const reading = Promise.withResolvers<void>();
    const controller = new AbortController();
    try {
      const result = streamAnthropic({
        endpoint: f.endpoint,
        modelId: 'fixture',
        apiKey: 'FAKE-KEY',
        messages: [{ role: 'user', content: 'fictional' }],
        signal: controller.signal,
        timeoutMs: 10_000,
        idleTimeoutMs: 5_000,
        onText: () => reading.resolve(),
      });
      const passed = assert.doesNotReject(result);
      const response = await f.received;
      if (phase === 'body') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(start);
        await reading.promise;
      }
      await nextTurn();
      clock.tick();
      clock.tick(360_000);
      await nextTurn();
      if (phase === 'headers') response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end((phase === 'headers' ? start : '') + stop);
      await passed;
      assert.equal(await result, 'OK');
    } finally {
      controller.abort();
      await f.close();
    }
  });
}

for (const stop of ['cancel', 'total', 'idle'] as const) {
  test(`pending TLS socket is released on ${stop}, not just a connected HTTP stream`, async () => {
    const accepted = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const sockets: Socket[] = [];
    // Accept TCP and consume ClientHello, but never complete TLS. No credentials sent.
    const server = createNetServer((socket) => {
      sockets.push(socket);
      socket.resume();
      socket.on('close', () => closed.resolve());
      accepted.resolve();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const controller = new AbortController();
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = streamAnthropic({
        endpoint: `https://127.0.0.1:${address.port}/v1/messages`,
        apiKey: 'FAKE-KEY',
        modelId: 'fixture',
        messages: [{ role: 'user', content: 'fictional' }],
        signal: controller.signal,
        timeoutMs: stop === 'total' ? 1_000 : 10_000,
        idleTimeoutMs: stop === 'idle' ? 1_000 : undefined,
        onText: () => {},
      });
      const failure = assert.rejects(result, (error: unknown) => {
        const diagnostic = publicAiDiagnostic(error);
        assert.equal(diagnostic.code, stop === 'cancel' ? 'AI_CANCELLED' : 'AI_TIMEOUT');
        if (stop !== 'cancel')
          assert.match(
            diagnostic.message,
            new RegExp(
              `reason=${stop === 'total' ? 'TOTAL_LIMIT' : 'IDLE_LIMIT'}; phase=CONNECTING`,
            ),
          );
        return true;
      });
      if (stop === 'cancel') {
        await accepted.promise;
        controller.abort();
      }
      await failure;
      await Promise.race([
        closed.promise,
        new Promise<void>((_, reject) => {
          guard = setTimeout(
            () =>
              reject(new Error('pending TLS socket was not released after request termination')),
            1_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(guard);
      controller.abort();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
