import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { streamChat, parseResume } from '../electron/chat-completions.js';
import { chatMatchResponseFormat } from '../shared/matching.js';
async function server(body: (response: import('node:http').ServerResponse) => void) {
  const instance = createServer((_request, response) => body(response));
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address() as import('node:net').AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    close: () =>
      new Promise<void>((resolve) => {
        instance.close(() => resolve());
        instance.closeAllConnections();
      }),
  };
}
const base = {
  apiKey: 'fake-local-key',
  modelId: 'mock-model',
  messages: [{ role: 'user', content: '测试' }],
  signal: new AbortController().signal,
  onText: (_text: string) => {},
};
test('SSE supports CRLF and split UTF-8 chunks, requiring complete stop', async () => {
  const local = await server((response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const text = Buffer.from(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: '你好' }, finish_reason: null }] }) +
        '\r\n\r\n',
    );
    for (const byte of text) response.write(Buffer.from([byte]));
    response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  try {
    assert.equal(await streamChat({ ...base, endpoint: local.endpoint }), '你好');
  } finally {
    await local.close();
  }
});
test('truncated, malformed, redirected and error replies never become completed output', async () => {
  for (const mode of ['truncated', 'malformed', 'error', 'redirect', 'length']) {
    const local = await server((response) => {
      if (mode === 'error') {
        response.writeHead(401);
        response.end('fake-local-key sensitive body');
        return;
      }
      if (mode === 'redirect') {
        response.writeHead(307, { location: 'http://127.0.0.1:1/' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (mode === 'malformed') response.end('data: broken\n\n');
      else
        response.end(
          'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":' +
            (mode === 'length' ? '"length"' : 'null') +
            '}]}\n\n',
        );
    });
    try {
      await assert.rejects(
        streamChat({ ...base, endpoint: local.endpoint }),
        (error) => error instanceof Error && !error.message.includes('fake-local-key'),
      );
    } finally {
      await local.close();
    }
  }
});
test('only complete typed resume fields are accepted, including fenced JSON', () => {
  assert.deepEqual(
    parseResume('```json\n{"document":"# 简历","suggestions":"留白","rationale":"相关性"}\n```'),
    { document: '# 简历', suggestions: '留白', rationale: '相关性' },
  );
  assert.throws(() => parseResume('{"document":""}'));
  assert.throws(() => parseResume('just markdown'));
});

test('request timeout and cancellation terminate without returning partial content', async () => {
  const local = await server((response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
  });
  try {
    await assert.rejects(
      streamChat({ ...base, endpoint: local.endpoint, timeoutMs: 50 }),
      /等待时间/,
    );
    const controller = new AbortController();
    const running = streamChat({
      ...base,
      endpoint: local.endpoint,
      signal: controller.signal,
      onText: () => controller.abort(),
    });
    await assert.rejects(running, /已取消/);
  } finally {
    await local.close();
  }
});

test('advanced request parameters are sent exactly as enabled without adding unsupported options', async () => {
  const seen: Record<string, unknown>[] = [];
  const instance = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as import('node:net').AddressInfo).port}/v1/chat/completions`;
  try {
    await streamChat({
      ...base,
      endpoint,
      parameters: { temperature: 0, maxCompletionTokens: 100, reasoningEffort: 'low' },
    });
    assert.equal(seen[0].temperature, 0);
    assert.equal(seen[0].max_completion_tokens, 100);
    assert.equal(seen[0].reasoning_effort, 'low');
    assert.equal('max_tokens' in seen[0], false);
    await streamChat({ ...base, endpoint });
    assert.equal('temperature' in seen[1], false);
    assert.equal('max_completion_tokens' in seen[1], false);
  } finally {
    await new Promise<void>((resolve) => {
      instance.close(() => resolve());
      instance.closeAllConnections();
    });
  }
});

test('clean EOF after explicit stop is distinct from a cut-off response', async () => {
  const local = await server((response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
    );
  });
  try {
    assert.equal(await streamChat({ ...base, endpoint: local.endpoint }), 'OK');
  } finally {
    await local.close();
  }
});
test('provider length and missing stop have different safe diagnostics', async () => {
  for (const reason of ['length', null]) {
    const local = await server((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: ' +
          JSON.stringify({
            choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: reason }],
          }) +
          '\n\ndata: [DONE]\n\n',
      );
    });
    try {
      await assert.rejects(streamChat({ ...base, endpoint: local.endpoint }), (error) => {
        assert.equal(
          (error as import('../shared/ai').AiError).diagnostic?.code,
          reason === 'length' ? 'AI_OUTPUT_LIMIT' : 'AI_STREAM_INCOMPLETE',
        );
        return true;
      });
    } finally {
      await local.close();
    }
  }
});

test('chat completion remains strict for dangling frames, untrusted finish values and stop-less JSON', async () => {
  const good =
    'data: ' +
    JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }) +
    '\n\n';
  for (const tail of ['data: {', 'data: {"choices":[]}\n', 'data: [DONE_EXTRA]']) {
    const local = await server((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(good + tail);
    });
    try {
      await assert.rejects(streamChat({ ...base, endpoint: local.endpoint }), /不完整/);
    } finally {
      await local.close();
    }
  }
  for (const ending of ['data: [DONE]', 'data: [DONE]\r', 'data: [DONE]\r\n\r\n']) {
    const local = await server((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(good.replaceAll('\n', '\r') + ending);
    });
    try {
      assert.equal(await streamChat({ ...base, endpoint: local.endpoint }), 'OK');
    } finally {
      await local.close();
    }
  }
});

test('Chat Completions can opt into a main-process JSON Schema response format', async () => {
  let request: Record<string, any> | undefined;
  const instance = createServer((req, response) => {
    let raw = '';
    req.on('data', (x) => (raw += x));
    req.on('end', () => {
      request = JSON.parse(raw);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(instance.address() as import('node:net').AddressInfo).port}/v1/chat/completions`;
  try {
    await streamChat({ ...base, endpoint, chatResponseJsonSchema: chatMatchResponseFormat() });
    assert.equal(request?.response_format?.type, 'json_schema');
    assert.equal(request?.response_format?.json_schema?.name, 'career_match');
    assert.equal(request?.response_format?.json_schema?.strict, true);
  } finally {
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  }
});
