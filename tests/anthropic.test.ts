import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { AnthropicStream, anthropicBody, streamAnthropic } from '../electron/anthropic.js';
import type { streamChat } from '../electron/chat-completions.js';
import { AiError } from '../shared/ai.js';
import { matchJsonSchema, parseMatch } from '../shared/matching';

type Event = Record<string, unknown>;
const options: Parameters<typeof streamChat>[0] = {
  endpoint: '',
  apiKey: 'FAKE-P07-SECRET',
  modelId: 'mock-anthropic',
  messages: [{ role: 'user', content: 'hello' }],
  signal: new AbortController().signal,
  onText: () => {},
};
const frame = (value: Event, eol = '\r\n') =>
  `event: ${value.type}${eol}data: ${JSON.stringify(value)}${eol}${eol}`;
const start = (): Event => ({
  type: 'message_start',
  message: {
    id: 'msg-fixture',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'mock-anthropic',
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 1 },
  },
});
const block = (index = 0, content_block: Event = { type: 'text', text: '' }): Event => ({
  type: 'content_block_start',
  index,
  content_block,
});
const delta = (text: string, index = 0): Event => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'text_delta', text },
});
const stopBlock = (index = 0): Event => ({ type: 'content_block_stop', index });
const stop = (reason: unknown = 'end_turn', sequence: unknown = null): Event => ({
  type: 'message_delta',
  delta: { stop_reason: reason, stop_sequence: sequence },
  usage: { output_tokens: 10 },
});
const end = (): Event => ({ type: 'message_stop' });
const success = (text = '你好🌏'): Event[] => [
  start(),
  block(),
  delta(text),
  stopBlock(),
  stop(),
  end(),
];
const encode = (events: Event[], eol = '\r\n') => events.map((event) => frame(event, eol)).join('');
const thinking = (index = 0): Event[] => [
  block(index, { type: 'thinking', thinking: '', signature: '' }),
  {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking: 'PRIVATE THINKING' },
  },
  {
    type: 'content_block_delta',
    index,
    delta: { type: 'signature_delta', signature: 'PRIVATE SIGNATURE' },
  },
  stopBlock(index),
];
async function local(
  handler: (res: ServerResponse, raw: string, req: IncomingMessage) => void | Promise<void>,
) {
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      void Promise.resolve(handler(res, raw, req)).catch(() => res.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/proxy/v1/messages`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
async function responseReject(body: string | Buffer, pattern?: RegExp) {
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  });
  try {
    await assert.rejects(
      streamAnthropic({ ...options, endpoint: service.endpoint }),
      (error: Error) => {
        assert.ok(error instanceof AiError);
        assert.doesNotMatch(error.message, /FAKE-P07-SECRET|PRIVATE|127\.0\.0\.1/);
        if (pattern) assert.match(error.message, pattern);
        return true;
      },
    );
  } finally {
    await service.close();
  }
}

// Pure mapping tests do not read or modify user data.
test('Anthropic request whitelist, system extraction, defaults, image mapping and enabled parameters', () => {
  const input = {
    ...options,
    messages: [
      { role: 'system', content: 'Advisor' },
      { role: 'system', content: [{ type: 'text' as const, text: 'Return JSON' }] },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'Describe' },
          ...(['png', 'jpeg', 'webp'] as const).map((mime) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/${mime};base64,AQID` },
          })),
        ],
      },
      { role: 'assistant', content: 'Previous answer' },
      { role: 'user', content: 'Continue' },
    ],
  };
  const original = structuredClone(input.messages);
  const body = anthropicBody(input);
  assert.deepEqual(Object.keys(body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'stream',
    'system',
  ]);
  assert.deepEqual(body.system, [
    { type: 'text', text: 'Advisor' },
    { type: 'text', text: 'Return JSON' },
  ]);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, true);
  assert.deepEqual(
    body.messages.map((msg) => msg.role),
    ['user', 'assistant', 'user'],
  );
  assert.deepEqual(
    body.messages[0].content.slice(1),
    ['png', 'jpeg', 'webp'].map((mime) => ({
      type: 'image',
      source: { type: 'base64', media_type: `image/${mime}`, data: 'AQID' },
    })),
  );
  assert.deepEqual(input.messages, original);
  assert.equal('system' in anthropicBody(options), false);
  for (const temperature of [0, 0.2, 1]) {
    const mapped = anthropicBody({
      ...options,
      parameters: { temperature, maxCompletionTokens: 123 },
    });
    assert.equal(mapped.temperature, temperature);
    assert.equal(mapped.max_tokens, 123);
  }
});

test('Anthropic rejects invalid numeric parameters, unknown fields and every reasoningEffort', () => {
  for (const temperature of [-1, 1.01, 2, NaN, Infinity, '0.5', null])
    assert.throws(
      () => anthropicBody({ ...options, parameters: { temperature } as never }),
      /温度/,
    );
  for (const maxCompletionTokens of [0, -1, 1.1, 1_000_001, NaN, Infinity, '100', null])
    assert.throws(
      () => anthropicBody({ ...options, parameters: { maxCompletionTokens } as never }),
      /输出上限/,
    );
  for (const reasoningEffort of ['low', 'medium', 'high', 'none', null])
    assert.throws(
      () => anthropicBody({ ...options, parameters: { reasoningEffort } as never }),
      /reasoningEffort/,
    );
  for (const key of ['tools', 'background', 'conversation', 'thinking', 'stop_sequences'])
    assert.throws(() => anthropicBody({ ...options, parameters: { [key]: true } as never }));
  assert.equal(
    anthropicBody({ ...options, parameters: { reasoningEffort: undefined } }).max_tokens,
    4096,
  );
});

test('Anthropic rejects unknown roles, moved system instructions and unsupported content', () => {
  for (const role of ['developer', 'tool', 'function', 'SYSTEM', '', null])
    assert.throws(() => anthropicBody({ ...options, messages: [{ role, content: 'x' }] as never }));
  for (const content of [
    null,
    {},
    [],
    [{ type: 'tool_use', id: 'x' }],
    [{ type: 'text', text: 5 }],
  ])
    assert.throws(() =>
      anthropicBody({ ...options, messages: [{ role: 'user', content }] as never }),
    );
  assert.throws(() => anthropicBody({ ...options, messages: [] }));
  assert.throws(() =>
    anthropicBody({ ...options, messages: [{ role: 'system', content: 'only' }] }),
  );
  assert.throws(() =>
    anthropicBody({
      ...options,
      messages: [...options.messages, { role: 'system', content: 'late' }],
    }),
  );
  assert.throws(() =>
    anthropicBody({ ...options, messages: Array(1001).fill(options.messages[0]) }),
  );
  assert.throws(() => anthropicBody({ ...options, modelId: 'PRIVATE\nMODEL' }));
});

test('Anthropic accepts only canonical inline base64 of the three allowed media types', () => {
  for (const url of [
    'https://example.com/PRIVATE.png',
    'file:///PRIVATE.png',
    'data:image/gif;base64,AQID',
    'data:image/jpg;base64,AQID',
    'data:image/svg+xml;base64,AQID',
    'data:image/png;foo=1;base64,AQID',
    'data:image/png;base64,',
    'data:image/png;base64,AQID\n',
    'data:image/png;base64,AQID ',
    'data:image/png;base64,AB==',
    'data:image/png;base64,AAA',
    'data:image/png;base64,AA-_',
    'data:image/png;base64,A===',
    'data:image/png;base64,AAAA====',
  ]) {
    assert.throws(() =>
      anthropicBody({
        ...options,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
      }),
    );
  }
  for (const role of ['assistant', 'system'])
    assert.throws(() =>
      anthropicBody({
        ...options,
        messages: [
          {
            role,
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }],
          },
        ],
      }),
    );
});

test('Anthropic request and individual image sizes are bounded including JSON escaping', () => {
  for (const text of ['x'.repeat(32_000_001), '\0'.repeat(5_400_000)])
    assert.throws(
      () => anthropicBody({ ...options, messages: [{ role: 'user', content: text }] }),
      /大小限制/,
    );
  const url = 'data:image/png;base64,' + Buffer.alloc(5_000_001).toString('base64');
  assert.throws(
    () =>
      anthropicBody({
        ...options,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
      }),
    /5 MB/,
  );
});

test('local HTTP request uses unchanged proxy endpoint, x-api-key/version (not bearer) and POST', async () => {
  let captured:
    | { method?: string; url?: string; headers: IncomingMessage['headers']; body: unknown }
    | undefined;
  const service = await local((res, raw, req) => {
    captured = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.end(encode(success()));
  });
  try {
    assert.equal(await streamAnthropic({ ...options, endpoint: service.endpoint }), '你好🌏');
    assert.equal(captured?.method, 'POST');
    assert.equal(captured?.url, '/proxy/v1/messages');
    assert.equal(captured?.headers['x-api-key'], options.apiKey);
    assert.equal(captured?.headers['anthropic-version'], '2023-06-01');
    assert.equal(captured?.headers.authorization, undefined);
    assert.equal(captured?.headers.accept, 'text/event-stream');
    assert.deepEqual(captured?.body, anthropicBody(options));
  } finally {
    await service.close();
  }
});

for (const eol of ['\n', '\r\n', '\r']) {
  test(`UTF8 and SSE ${JSON.stringify(eol)} split at every byte, comments, ping and multi-line data`, async () => {
    const service = await local(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = success('中🙂文');
      const payload =
        '\ufeff: comment' +
        eol +
        eol +
        frame({ type: 'ping' }, eol) +
        encode(events.slice(0, 2), eol) +
        `event: content_block_delta${eol}data: {"type":"content_block_delta",${eol}data: "index":0,"delta":{"type":"text_delta","text":"中🙂文"}}${eol}${eol}` +
        encode(events.slice(3), eol);
      for (const byte of Buffer.from(payload)) {
        if (res.destroyed) break;
        res.write(Buffer.from([byte]));
        await setImmediate();
      }
      // Deliberately leave the response open: message_stop, not EOF, is the terminator.
    });
    const chunks: string[] = [];
    try {
      assert.equal(
        await streamAnthropic({
          ...options,
          endpoint: service.endpoint,
          timeoutMs: 3000,
          onText: (text) => chunks.push(text),
        }),
        '中🙂文',
      );
      assert.deepEqual(chunks, ['中🙂文']);
    } finally {
      await service.close();
    }
  });
}

test('thinking, signatures and redacted thinking never enter callbacks or the result', async () => {
  const events = [
    start(),
    ...thinking(),
    block(1, { type: 'redacted_thinking', data: 'PRIVATE REDACTED' }),
    stopBlock(1),
    block(2),
    delta('A', 2),
    stopBlock(2),
    block(3),
    delta('文', 3),
    stopBlock(3),
    stop(),
    end(),
  ];
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(encode(events));
  });
  const chunks: string[] = [];
  try {
    assert.equal(
      await streamAnthropic({
        ...options,
        endpoint: service.endpoint,
        onText: (text) => chunks.push(text),
      }),
      'A文',
    );
    assert.deepEqual(chunks, ['A', '文']);
  } finally {
    await service.close();
  }
});

test('pure parser requires exact indices and a single sequential block/message lifecycle', () => {
  const bad: Event[][] = [
    [block()],
    [delta('x')],
    [stopBlock()],
    [stop()],
    [end()],
    [start(), start()],
    [start(), block(1)],
    [start(), block(-1)],
    [start(), block(0.5)],
    [start(), block('0' as never)],
    [start(), block(Number.MAX_SAFE_INTEGER + 1)],
    [start(), block(), block(1)],
    [start(), block(), delta('x', 1)],
    [start(), block(), stopBlock(1)],
    [start(), block(), stopBlock(), stopBlock()],
    [start(), block(), stopBlock(), block(0)],
    [start(), block(), stopBlock(), delta('x')],
    [start(), block(), delta('x'), stop()],
    [start(), block(), delta('x'), stopBlock(), end()],
    [start(), block(), delta('x'), stopBlock(), stop(), stop()],
    [start(), block(), delta('x'), stopBlock(), stop(), block(1)],
    [...success(), end()],
    [...success(), delta('late')],
    [...success(), { type: 'ping' }],
    [
      start(),
      block(),
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 1 } },
    ],
    [start(), block(), thinking()[1]],
    [start(), thinking()[0], delta('leak')],
    [start(), thinking()[0], stopBlock()],
    [start(), thinking()[0], thinking()[2], thinking()[1]],
    [start(), block(0, { type: 'redacted_thinking', data: '' })],
    [start(), block(0, { type: 'redacted_thinking', data: 'private' }), delta('leak')],
    [start(), { type: 'unknown_future_event' }],
  ];
  for (const events of bad) {
    const parser = new AnthropicStream(() => {});
    assert.throws(
      () => events.forEach((event) => parser.frame(frame(event))),
      AiError,
      JSON.stringify(events),
    );
  }
  for (const message of [
    null,
    { ...(start().message as Event), role: 'user' },
    { ...(start().message as Event), id: '' },
    { ...(start().message as Event), content: [{ type: 'text', text: 'x' }] },
    { ...(start().message as Event), stop_reason: 'end_turn' },
  ])
    assert.throws(() =>
      new AnthropicStream(() => {}).frame(frame({ type: 'message_start', message })),
    );
});

test('HTTP rejects every truncated lifecycle including text-without-message_stop and unterminated final event', async () => {
  const events = success();
  for (let length = 0; length < events.length; length++)
    await responseReject(encode(events.slice(0, length)), /提前结束/);
  await responseReject(encode(events).trimEnd(), /提前结束/);
  await responseReject(encode(events.slice(0, -1)) + 'data: [DONE]\n\n');
  await responseReject(
    encode(events.slice(0, -1)) + frame({ type: 'message_stop' }).slice(0, -2),
    /提前结束/,
  );
});

for (const reason of [
  'max_tokens',
  'tool_use',
  'refusal',
  'pause_turn',
  'pause',
  'stop_sequence',
  'model_context_window_exceeded',
  null,
  'unknown',
]) {
  test(`HTTP refuses stop reason ${String(reason)} even when followed by message_stop`, async () => {
    await responseReject(
      encode([start(), block(), delta('partial'), stopBlock(), stop(reason), end()]),
      /end_turn/,
    );
  });
}

test('empty/whitespace/thinking-only bodies and unsolicited stop_sequence are rejected', async () => {
  for (const text of ['', ' \n\t']) await responseReject(encode(success(text)));
  await responseReject(encode([start(), ...thinking(), stop(), end()]));
  await responseReject(encode([start(), stop(), end()]));
  await responseReject(
    encode([start(), block(), delta('x'), stopBlock(), stop('end_turn', 'PRIVATE'), end()]),
  );
});

test('tool/refusal blocks and input_json_delta are rejected rather than ignored', async () => {
  for (const type of [
    'tool_use',
    'server_tool_use',
    'web_search_tool_result',
    'refusal',
    'future_block',
  ])
    await responseReject(encode([start(), block(0, { type, id: 'PRIVATE' })]));
  await responseReject(
    encode([
      start(),
      block(),
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'PRIVATE' },
      },
    ]),
  );
});

test('malformed data, mismatched names, duplicate event fields, invalid UTF8 and error payloads fail sanitized', async () => {
  for (const raw of [
    'data: PRIVATE\n\n',
    'data: null\n\n',
    'data: []\n\n',
    'data: {}\n\n',
    'event: ping\ndata: {"type":"message_stop"}\n\n',
    'event: ping\nevent: ping\ndata: {"type":"ping"}\n\n',
    'event: message_stop\n\n',
    frame({ type: 'error', error: { message: 'PRIVATE FAKE-P07-SECRET' } }),
  ])
    await responseReject(raw);
  await responseReject(
    Buffer.concat([Buffer.from(encode(success().slice(0, 2))), Buffer.from([0xff])]),
  );
  await responseReject(
    Buffer.concat([Buffer.from(encode(success().slice(0, 2))), Buffer.from([0xe4, 0xb8])]),
  );
  await responseReject(Buffer.concat([Buffer.from(encode(success())), Buffer.from([0xe4])]));
  await responseReject(encode(success()) + frame({ type: 'error', error: { message: 'PRIVATE' } }));
  await responseReject(encode(success()) + 'PRIVATE');
});

test('output, per-frame and total streamed byte limits fail safely', async () => {
  await responseReject(encode(success('x'.repeat(700_001))), /输出过长/);
  await responseReject(':' + 'x'.repeat(1_000_001), /大小限制/);
  await responseReject(
    encode([
      start(),
      ...Array.from({ length: 42 }, () => ({ type: 'ping', ignored: 'x'.repeat(100_000) })),
    ]),
    /大小限制/,
  );
  const parser = new AnthropicStream(() => {});
  [start(), block(), delta('x'.repeat(700_000)), stopBlock(), stop(), end()].forEach((event) =>
    parser.frame(frame(event)),
  );
  assert.equal(parser.result?.length, 700_000);
});

test('HTTP status bodies, incorrect media types and network errors do not disclose provider data', async () => {
  for (const mode of ['401', '403', '429', '500', 'json', 'fake-sse', 'disconnect']) {
    const service = await local((res) => {
      if (mode === 'disconnect') {
        res.destroy();
        return;
      }
      res.writeHead(/^\d/.test(mode) ? Number(mode) : 200, {
        'content-type':
          mode === 'json'
            ? 'application/json'
            : mode === 'fake-sse'
              ? 'text/event-stream-private'
              : 'text/event-stream',
      });
      res.end('PRIVATE FAKE-P07-SECRET');
    });
    try {
      await assert.rejects(
        streamAnthropic({ ...options, endpoint: service.endpoint }),
        (error: Error) => {
          assert.ok(error instanceof AiError);
          assert.doesNotMatch(error.message, /PRIVATE|FAKE-P07-SECRET|127\.0\.0\.1/);
          if (mode === '401' || mode === '403') assert.match(error.message, /认证失败/);
          if (mode === '429') assert.match(error.message, /限流/);
          return true;
        },
      );
    } finally {
      await service.close();
    }
  }
});

test('all redirects are refused without sending a second request or credential', async () => {
  let trapHits = 0;
  const trap = await local((res) => {
    trapHits++;
    res.end('trap');
  });
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      const service = await local((res) => {
        res.writeHead(status, { location: trap.endpoint });
        res.end('PRIVATE');
      });
      try {
        await assert.rejects(
          streamAnthropic({ ...options, endpoint: service.endpoint }),
          /不会跟随重定向/,
        );
      } finally {
        await service.close();
      }
    }
    assert.equal(trapHits, 0);
  } finally {
    await trap.close();
  }
});

test('invalid requests are rejected before any HTTP request', async () => {
  let hits = 0;
  const service = await local((res) => {
    hits++;
    res.end();
  });
  try {
    for (const change of [
      { parameters: { reasoningEffort: 'high' } },
      { parameters: { temperature: 2 } },
      { apiKey: 'PRIVATE\nHEADER' },
    ])
      await assert.rejects(
        streamAnthropic({ ...options, endpoint: service.endpoint, ...change } as Parameters<
          typeof streamChat
        >[0]),
      );
    for (const endpoint of [
      'http://example.com/v1/messages',
      'file:///PRIVATE',
      'https://PRIVATE:SECRET@example.com/v1/messages',
      service.endpoint + '?key=PRIVATE',
      service.endpoint + '#PRIVATE',
    ])
      await assert.rejects(streamAnthropic({ ...options, endpoint }));
    const controller = new AbortController();
    controller.abort('PRIVATE');
    await assert.rejects(
      streamAnthropic({ ...options, endpoint: service.endpoint, signal: controller.signal }),
      /已取消/,
    );
    assert.equal(hits, 0);
  } finally {
    await service.close();
  }
});

test('timeout before headers and during stream never returns partial text', async () => {
  for (const sendPartial of [false, true]) {
    const service = await local((res) => {
      if (sendPartial) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(encode(success('partial').slice(0, 3)));
      }
    });
    try {
      await assert.rejects(
        streamAnthropic({ ...options, endpoint: service.endpoint, timeoutMs: 40 }),
        /等待时间/,
      );
    } finally {
      await service.close();
    }
  }
});

test('user abort stops callbacks and rejects even with message_stop in the same packet', async () => {
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      encode([start(), block(), delta('first'), delta('second'), stopBlock(), stop(), end()]),
    );
  });
  const controller = new AbortController();
  const chunks: string[] = [];
  try {
    await assert.rejects(
      streamAnthropic({
        ...options,
        endpoint: service.endpoint,
        signal: controller.signal,
        onText: (text) => {
          chunks.push(text);
          controller.abort('PRIVATE');
        },
      }),
      /已取消/,
    );
    assert.deepEqual(chunks, ['first']);
  } finally {
    await service.close();
  }
});

test('callback exceptions are sanitized and the response stream is canceled', async () => {
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(encode(success().slice(0, 3)));
  });
  try {
    await assert.rejects(
      streamAnthropic({
        ...options,
        endpoint: service.endpoint,
        onText: () => {
          throw new AiError('PRIVATE FAKE-P07-SECRET');
        },
      }),
      /正文回调失败/,
    );
  } finally {
    await service.close();
  }
});

test('Anthropic matching schema is opt-in and sent only in output_config.format', () => {
  const schema = matchJsonSchema();
  const body = anthropicBody({ ...options, anthropicResponseJsonSchema: schema });
  assert.deepEqual(body.output_config, { format: { type: 'json_schema', schema } });
  assert.equal(anthropicBody(options).output_config, undefined);
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object') {
      assert.equal(obj.additionalProperties, false);
      assert.deepEqual(
        [...(obj.required as string[])].sort(),
        Object.keys(obj.properties as object).sort(),
      );
    }
    assert.ok(!('minLength' in obj) && !('maxLength' in obj) && !('minimum' in obj));
    Object.values(obj).forEach(visit);
  };
  visit(schema);
  assert.doesNotMatch(JSON.stringify(schema), /FAKE-P07-SECRET|PRIVATE|127\.0\.0\.1/);
});

test('Anthropic sequential text blocks preserve a single fenced match and exclude thinking', async () => {
  const json = JSON.stringify({
    requirements: [
      {
        id: 'r1',
        requirement: 'Python',
        hard: false,
        status: 'met',
        jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
        evidence: [{ sourceId: 'resume', quote: 'Python' }],
        note: 'Verified',
      },
    ],
    summary: 'Verified',
    recommendation: 'consider',
    reasons: [],
    warnings: [],
  });
  const events = [
    start(),
    ...thinking(),
    block(1),
    delta('Here is the result:\n', 1),
    stopBlock(1),
    block(2, { type: 'text', text: '```json\n' }),
    delta(json.slice(0, 60), 2),
    delta(json.slice(60), 2),
    delta('\n```', 2),
    stopBlock(2),
    stop(),
    end(),
  ];
  const server = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(encode(events));
  });
  try {
    const text = await streamAnthropic({ ...options, endpoint: server.endpoint });
    assert.doesNotMatch(text, /PRIVATE/);
    assert.equal(parseMatch(text, 'Python', 'Python').coverage, 100);
  } finally {
    await server.close();
  }
});
