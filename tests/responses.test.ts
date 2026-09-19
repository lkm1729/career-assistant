import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { ResponsesStream, responsesBody, streamResponses } from '../electron/responses.js';
import { protocolEndpoint } from '../shared/ai.js';
import { wireParameters } from '../shared/models.js';
const frame = (value: Record<string, unknown>) =>
  `event: ${value.type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const message = (text: string) => ({
  id: 'msg-1',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const completed = (text: string) => ({
  type: 'response.completed',
  response: {
    id: 'resp-1',
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [message(text)],
  },
});
const delta = (text: string) => ({
  type: 'response.output_text.delta',
  output_index: 0,
  content_index: 0,
  item_id: 'msg-1',
  delta: text,
});
const options = {
  endpoint: '',
  apiKey: 'FAKE-P05-KEY',
  modelId: 'mock',
  messages: [{ role: 'user', content: 'hello' }],
  signal: new AbortController().signal,
  onText: (_text: string) => {},
};
async function local(
  handler: (response: ServerResponse, raw: string, auth: string | undefined) => void,
) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (data) => {
      raw += data;
    });
    request.on('end', () => handler(response, raw, request.headers.authorization));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1/responses`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

test('Responses endpoints preserve prefixes and normalize either known suffix without unsafe addresses', () => {
  for (const [base, expected] of [
    ['https://example.com', 'https://example.com/v1/responses'],
    ['https://example.com/proxy/v1/', 'https://example.com/proxy/v1/responses'],
    ['https://example.com/proxy/v1/responses/', 'https://example.com/proxy/v1/responses'],
    ['https://example.com/proxy/v1/chat/completions', 'https://example.com/proxy/v1/responses'],
    ['https://example.com/responses', 'https://example.com/responses'],
  ])
    assert.equal(protocolEndpoint(base, 'responses'), expected);
  assert.equal(
    protocolEndpoint('https://example.com/v1/responses', 'chat-completions'),
    'https://example.com/v1/chat/completions',
  );
  for (const base of [
    'http://example.com',
    'file:///x',
    'https://user:password@example.com',
    'https://example.com?key=secret',
    'https://example.com#secret',
    'https://example.com/v1/completions',
  ])
    assert.throws(() => protocolEndpoint(base, 'responses'));
});
test('Responses maps parameters, text and image input without Chat-only fields or remote conversation state', () => {
  const body = responsesBody({
    ...options,
    parameters: { temperature: 0.2, maxCompletionTokens: 4096, reasoningEffort: 'high' },
    messages: [
      { role: 'system', content: 'Advisor' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What color?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,TEST' } },
        ],
      },
    ],
  });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.input[1].content, [
    { type: 'input_text', text: 'What color?' },
    { type: 'input_image', image_url: 'data:image/png;base64,TEST', detail: 'auto' },
  ]);
  assert.ok('max_output_tokens' in body && 'reasoning' in body);
  assert.equal(body.max_output_tokens, 4096);
  assert.deepEqual(body.reasoning, { effort: 'high' });
  for (const key of [
    'messages',
    'max_completion_tokens',
    'reasoning_effort',
    'previous_response_id',
    'conversation',
    'tools',
    'background',
  ])
    assert.equal(key in body, false);
  assert.throws(() => wireParameters({ maxCompletionTokens: 15 }, 'responses'), /至少为 16/);
  assert.deepEqual(wireParameters({ maxCompletionTokens: 1 }), { max_completion_tokens: 1 });
});
test('Responses handles split UTF-8, CRLF, lifecycle and completion without Chat DONE', async () => {
  let requestBody: unknown;
  let authorization: string | undefined;
  const parts: string[] = [];
  const service = await local((res, raw, auth) => {
    requestBody = JSON.parse(raw);
    authorization = auth;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = Buffer.from(
      ': comment\r\n\r\n' +
        frame({ type: 'response.created', response: { id: 'resp-1' } }) +
        frame(delta('你好')) +
        frame(completed('你好')),
    );
    for (const byte of data) res.write(Buffer.from([byte]));
    res.end();
  });
  try {
    assert.equal(
      await streamResponses({
        ...options,
        endpoint: service.endpoint,
        onText: (text) => parts.push(text),
      }),
      '你好',
    );
    assert.deepEqual(parts, ['你好']);
    assert.equal(authorization, 'Bearer FAKE-P05-KEY');
    assert.equal((requestBody as { store: boolean }).store, false);
  } finally {
    await service.close();
  }
});
test('Responses completed text is authoritative, reasoning never leaks into the document or preview', () => {
  const seen: string[] = [];
  const stream = new ResponsesStream((s) => seen.push(s));
  stream.frame(frame({ type: 'response.reasoning_summary_text.delta', delta: 'HIDDEN REASONING' }));
  stream.frame(
    frame({
      type: 'response.completed',
      response: {
        id: 'resp-1',
        status: 'completed',
        output: [{ type: 'reasoning', summary: [] }, message('Final only')],
      },
    }),
  );
  assert.equal(stream.result, 'Final only');
  assert.deepEqual(seen, ['Final only']);
});
for (const [name, event] of [
  [
    'failed',
    { type: 'response.failed', response: { error: { message: 'PRIVATE PROVIDER TEXT' } } },
  ],
  ['error', { type: 'error', message: 'PRIVATE PROVIDER TEXT' }],
  ['incomplete', { type: 'response.incomplete', response: { status: 'incomplete' } }],
  ['refusal', { type: 'response.refusal.delta', delta: 'PRIVATE PROVIDER TEXT' }],
  [
    'tool',
    {
      type: 'response.output_item.added',
      item: { type: 'function_call', arguments: 'PRIVATE PROVIDER TEXT' },
    },
  ],
  ['bad-delta', { ...delta('x'), delta: 42 }],
  ['bad-event', {}],
] as const)
  test(`Responses ${name} rejects without returning private provider details`, () => {
    const stream = new ResponsesStream(() => {});
    assert.throws(
      () => stream.frame(frame(event)),
      (error: Error) => !error.message.includes('PRIVATE PROVIDER TEXT'),
    );
    assert.equal(stream.result, null);
  });
test('Responses rejects inconsistent final content, missing delta segments, response identity and sequence replay', () => {
  let stream = new ResponsesStream(() => {});
  stream.frame(frame(delta('partial')));
  assert.throws(() => stream.frame(frame(completed('different'))), /不一致/);
  stream = new ResponsesStream(() => {});
  stream.frame(frame({ ...delta('x'), output_index: 2 }));
  assert.throws(() => stream.frame(frame(completed('x'))), /完整的正文/);
  stream = new ResponsesStream(() => {});
  stream.frame(frame({ type: 'response.created', response: { id: 'other' } }));
  assert.throws(() => stream.frame(frame(completed('x'))), /标识不一致/);
  stream = new ResponsesStream(() => {});
  stream.frame(frame({ ...delta('x'), sequence_number: 1 }));
  assert.throws(() => stream.frame(frame({ ...delta('x'), sequence_number: 1 })), /顺序无效/);
  stream = new ResponsesStream(() => {});
  assert.throws(
    () => stream.frame('event: response.completed\ndata: ' + JSON.stringify(delta('x'))),
    /类型不一致/,
  );
});
test('Responses final output rejects refusal, tools, incomplete message, empty or non-completed response', () => {
  for (const response of [
    { id: 'r', status: 'incomplete', output: [message('x')] },
    { id: 'r', status: 'completed', output: [] },
    { id: 'r', status: 'completed', output: [{ ...message('x'), status: 'in_progress' }] },
    {
      id: 'r',
      status: 'completed',
      output: [{ ...message('x'), content: [{ type: 'refusal', refusal: 'no' }] }],
    },
    { id: 'r', status: 'completed', output: [{ type: 'function_call' }] },
    { id: 'r', status: 'completed', error: { message: 'secret' }, output: [message('x')] },
  ])
    assert.throws(() =>
      new ResponsesStream(() => {}).frame(frame({ type: 'response.completed', response })),
    );
});
test('Responses rejects oversized delta and complete-only text', () => {
  assert.throws(
    () => new ResponsesStream(() => {}).frame(frame(delta('x'.repeat(700001)))),
    /过长/,
  );
  assert.throws(
    () => new ResponsesStream(() => {}).frame(frame(completed('x'.repeat(700001)))),
    /过长/,
  );
});
test('Responses EOF, DONE and output_text.done cannot stand in for response.completed', async () => {
  for (const ending of [
    '',
    'data: [DONE]\n\n',
    frame({ type: 'response.output_text.done', text: 'x' }),
  ]) {
    const service = await local((res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(frame(delta('x')) + ending);
    });
    try {
      await assert.rejects(streamResponses({ ...options, endpoint: service.endpoint }));
    } finally {
      await service.close();
    }
  }
});
test('Responses auth, throttling, redirects, non-SSE, malformed JSON and byte limits fail safely', async () => {
  for (const mode of ['401', '403', '429', '302', 'json', 'malformed', 'oversized']) {
    const service = await local((res) => {
      if (/^\d/.test(mode)) {
        res.writeHead(Number(mode), { location: 'http://127.0.0.1:1/leak' });
        res.end('PRIVATE BODY');
      } else {
        res.writeHead(200, {
          'content-type': mode === 'json' ? 'application/json' : 'text/event-stream',
        });
        res.end(
          mode === 'json'
            ? '{}'
            : mode === 'oversized'
              ? ':' + 'x'.repeat(4000001)
              : 'data: invalid\n\n',
        );
      }
    });
    try {
      await assert.rejects(
        streamResponses({ ...options, endpoint: service.endpoint }),
        (error: Error) => !error.message.includes('PRIVATE BODY'),
      );
    } finally {
      await service.close();
    }
  }
});
test('Responses cancellation and timeout do not return partial output', async () => {
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(frame(delta('partial')));
  });
  try {
    await assert.rejects(
      streamResponses({ ...options, endpoint: service.endpoint, timeoutMs: 30 }),
      /等待时间/,
    );
    const controller = new AbortController();
    await assert.rejects(
      streamResponses({
        ...options,
        endpoint: service.endpoint,
        signal: controller.signal,
        onText: () => controller.abort(),
      }),
      /已取消/,
    );
  } finally {
    await service.close();
  }
});

test('Responses distinguishes explicit max_output_tokens from unspecified incomplete reason', () => {
  for (const reason of ['max_output_tokens', undefined]) {
    const stream = new ResponsesStream(() => {});
    assert.throws(
      () =>
        stream.frame(
          frame({
            type: 'response.incomplete',
            response: {
              id: 'fixture',
              status: 'incomplete',
              incomplete_details: reason ? { reason } : null,
            },
          }).trim(),
        ),
      (error) => {
        assert.equal(
          (error as import('../shared/ai').AiError).diagnostic?.code,
          reason ? 'AI_OUTPUT_LIMIT' : 'AI_STREAM_INCOMPLETE',
        );
        return true;
      },
    );
  }
});
