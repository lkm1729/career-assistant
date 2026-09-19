import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate as tick, setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';
import { GeminiStream, geminiBody, streamGemini } from '../electron/gemini.js';
import { AiError } from '../shared/ai.js';

type Options = Parameters<typeof streamGemini>[0];
const secret = 'FAKE-P06-KEY-DO-NOT-LEAK';
const options: Options = {
  endpoint: '',
  apiKey: secret,
  modelId: 'gemini-mock',
  messages: [{ role: 'user', content: 'hello' }],
  signal: new AbortController().signal,
  onText: () => {},
  timeoutMs: 3000,
};
const frame = (value: unknown, newline = '\n') =>
  `data: ${JSON.stringify(value)}${newline}${newline}`;
const chunk = (parts: unknown[], finishReason?: unknown) => ({
  responseId: 'r-1',
  modelVersion: 'gemini-mock-001',
  candidates: [
    {
      index: 0,
      content: { role: 'model', parts },
      ...(finishReason === undefined ? {} : { finishReason }),
    },
  ],
});
const text = (value: string) => chunk([{ text: value }]);
const stop = (value = '') => chunk(value ? [{ text: value }] : [], 'STOP');
const resume = JSON.stringify({
  document: '# 简历\n实际材料 ✅',
  suggestions: '清晰排版',
  rationale: '不虚构事实',
});

async function local(
  handler: (res: ServerResponse, req: IncomingMessage, raw: string) => void | Promise<void>,
) {
  const requests: {
    url: string | undefined;
    method: string | undefined;
    headers: IncomingMessage['headers'];
    raw: string;
  }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (data: Buffer) => {
      raw += data.toString();
    });
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, headers: req.headers, raw });
      Promise.resolve(handler(res, req, raw)).catch(() => res.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  return {
    endpoint: `http://127.0.0.1:${address.port}/proxy/v1beta/models/gemini-mock:streamGenerateContent?alt=sse`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
async function runSSE(payload: string | Buffer, extra: Partial<Options> = {}) {
  const service = await local((res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.end(payload);
  });
  try {
    return await streamGemini({ ...options, ...extra, endpoint: service.endpoint });
  } finally {
    await service.close();
  }
}
function redacted(error: unknown): boolean {
  assert.ok(error instanceof AiError);
  assert.ok(!error.message.includes(secret));
  assert.ok(!error.message.includes('PRIVATE'));
  assert.ok(!error.message.includes('http://'));
  return true;
}

test('Gemini sends the complete shared endpoint unchanged, key only in header, native body and JSON resume text', async () => {
  const seen: string[] = [];
  const service = await local((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frame(stop(resume)));
  });
  try {
    const result = await streamGemini({
      ...options,
      endpoint: service.endpoint,
      modelId: 'not-to-be-rebuilt',
      onText: (t) => seen.push(t),
      messages: [
        { role: 'system', content: '系统 1' },
        { role: 'system', content: [{ type: 'text', text: '系统 2' }] },
        { role: 'user', content: '需求' },
        { role: 'assistant', content: [{ type: 'text', text: '旧正文' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: '参考画像' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==' } },
            { type: 'image_url', image_url: { url: 'data:image/webp;base64,UklGRg==' } },
          ],
        },
      ],
      parameters: { temperature: 0, maxCompletionTokens: 1234 },
    });
    assert.equal(result, resume);
    assert.equal(seen.join(''), resume);
    assert.equal(JSON.parse(result).document, '# 简历\n实际材料 ✅');
    assert.equal(service.requests.length, 1);
    const request = service.requests[0];
    assert.equal(request.url, '/proxy/v1beta/models/gemini-mock:streamGenerateContent?alt=sse');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-goog-api-key'], secret);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.accept, 'text/event-stream');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.ok(!request.raw.includes(secret));
    assert.deepEqual(JSON.parse(request.raw), {
      systemInstruction: { parts: [{ text: '系统 1' }, { text: '系统 2' }] },
      contents: [
        { role: 'user', parts: [{ text: '需求' }] },
        { role: 'model', parts: [{ text: '旧正文' }] },
        {
          role: 'user',
          parts: [
            { text: '参考画像' },
            { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            { inlineData: { mimeType: 'image/jpeg', data: '/9j/2Q==' } },
            { inlineData: { mimeType: 'image/webp', data: 'UklGRg==' } },
          ],
        },
      ],
      generationConfig: { candidateCount: 1, temperature: 0, maxOutputTokens: 1234 },
    });
  } finally {
    await service.close();
  }
});

test('Gemini minimal request omits system and unspecified tuning; assistant images use model role', () => {
  assert.deepEqual(geminiBody(options), {
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: { candidateCount: 1 },
  });
  assert.deepEqual(
    geminiBody({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }],
        },
      ],
    }).contents[0],
    {
      role: 'model',
      parts: [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }],
    },
  );
});

test('Gemini rejects unsafe input and reasoning before making any network request', async (t) => {
  const invalidInputs: [string, unknown][] = [
    ...['developer', 'tool', 'function', 'model', '', 'PRIVATE ROLE'].map(
      (role) => [role, { messages: [{ role, content: secret }] }] as [string, unknown],
    ),
    ...[
      'https://example.com/private.png',
      'http://127.0.0.1/private.png',
      'file:///private.png',
      'data:image/gif;base64,YQ==',
      'data:image/jpg;base64,YQ==',
      'data:image/svg+xml;base64,YQ==',
      'data:image/PNG;base64,YQ==',
      'data:image/png;charset=utf8;base64,YQ==',
      'data:image/png;base64,',
      'data:image/png;base64,YQ',
      'data:image/png;base64,Y Q==',
      'data:image/png;base64,YQ==\n',
      'data:image/png;base64,YR==',
      'data:image/png;base64,YQ===',
      'data:image/png;base64,__==',
      'data:image/png;base64,====',
    ].map(
      (url) =>
        [
          url,
          { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] },
        ] as [string, unknown],
    ),
    [
      'system image',
      {
        messages: [
          {
            role: 'system',
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }],
          },
        ],
      },
    ],
    [
      'unknown part',
      { messages: [{ role: 'user', content: [{ type: 'input_file', data: secret }] }] },
    ],
    ['non-string text', { messages: [{ role: 'user', content: [{ type: 'text', text: 42 }] }] }],
    ['null part', { messages: [{ role: 'user', content: [null] }] }],
    ['null content', { messages: [{ role: 'user', content: null }] }],
    ['empty parts', { messages: [{ role: 'user', content: [] }] }],
    ['empty messages', { messages: [] }],
    ['system only', { messages: [{ role: 'system', content: 'x' }] }],
    ['null message', { messages: [null] }],
    ['messages not array', { messages: {} }],
    [
      'image missing URL',
      { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }] },
    ],
    ...['low', 'medium', 'high'].map(
      (reasoningEffort) =>
        [`reasoning ${reasoningEffort}`, { parameters: { reasoningEffort } }] as [string, unknown],
    ),
    ['negative temperature', { parameters: { temperature: -0.1 } }],
    ['nonfinite temperature', { parameters: { temperature: NaN } }],
    ['zero tokens', { parameters: { maxCompletionTokens: 0 } }],
    ['fractional tokens', { parameters: { maxCompletionTokens: 1.5 } }],
    ['unknown tuning', { parameters: { tools: [] } }],
  ];
  const service = await local((res) => {
    res.end();
  });
  try {
    for (const [name, extra] of invalidInputs)
      await t.test(name, async () => {
        await assert.rejects(
          streamGemini({ ...options, ...(extra as Partial<Options>), endpoint: service.endpoint }),
          redacted,
        );
      });
    assert.equal(service.requests.length, 0);
  } finally {
    await service.close();
  }
});

test('Gemini handles true UTF8 byte fragmentation, SSE comments, multiline JSON, BOM and all newline styles', async (t) => {
  for (const newline of ['\n', '\r\n', '\r'])
    await t.test(JSON.stringify(newline), async () => {
      const service = await local(async (res) => {
        res.writeHead(200, { 'content-type': 'Text/Event-Stream; charset=UTF-8' });
        res.socket?.setNoDelay(true);
        const multiline = JSON.stringify(text('简历🦊\n正文'), null, 2)
          .split('\n')
          .map((line) => `data: ${line}`)
          .join(newline);
        const payload = Buffer.from(
          '\uFEFF' +
            `: ping${newline}id: ignored${newline}retry: 10${newline}${newline}event: message${newline}${multiline}${newline}${newline}` +
            frame(stop('完成'), newline),
        );
        for (const byte of payload) {
          res.write(Buffer.from([byte]));
          await tick();
        }
        res.end();
      });
      try {
        const seen: string[] = [];
        assert.equal(
          await streamGemini({
            ...options,
            endpoint: service.endpoint,
            onText: (v) => seen.push(v),
          }),
          '简历🦊\n正文完成',
        );
        assert.deepEqual(seen, ['简历🦊\n正文', '完成']);
      } finally {
        await service.close();
      }
    });
});

test('Gemini hides thought text/signatures but retains visible text carrying a signature', async () => {
  const seen: string[] = [];
  const parts = [
    { text: 'PRIVATE THOUGHT ' + secret, thought: true, thoughtSignature: 'PRIVATE_SIGNATURE' },
    { text: '正文', thought: false },
    { thoughtSignature: 'PRIVATE_SIGNATURE_ONLY' },
    { text: '签名正文', thoughtSignature: 'PRIVATE_FINAL_SIGNATURE' },
  ];
  assert.equal(
    await runSSE(frame(chunk(parts)) + frame(stop('完成')), { onText: (v) => seen.push(v) }),
    '正文签名正文完成',
  );
  assert.deepEqual(seen, ['正文', '签名正文', '完成']);
  const parser = new GeminiStream(() => {});
  parser.frame(frame(chunk(parts, 'STOP')));
  assert.equal(parser.finish(), '正文签名正文');
  assert.ok(!JSON.stringify(parser).includes('PRIVATE'));
  assert.ok(!inspect(parser).includes('PRIVATE'));
});

test('Gemini accepts optional identity/role, finish-only STOP, and usage metadata before/after completion', async () => {
  const seen: string[] = [];
  const payload =
    frame({ usageMetadata: { promptTokenCount: 3 }, candidates: [] }) +
    frame({ candidates: [{ index: 0, content: { parts: [{ text: '正文' }] } }] }) +
    frame({
      responseId: 'r',
      modelVersion: 'resolved-alias',
      candidates: [{ index: 0, finishReason: 'STOP' }],
    }) +
    frame({
      responseId: 'r',
      modelVersion: 'resolved-alias',
      usageMetadata: { candidatesTokenCount: 1 },
    });
  assert.equal(await runSSE(payload, { onText: (v) => seen.push(v) }), '正文');
  assert.deepEqual(seen, ['正文']);
});

test('Gemini rejects every non-STOP finish, blocking and tool/refusal outputs without leaking frame text', async (t) => {
  const events: [string, unknown][] = [
    ...[
      'MAX_TOKENS',
      'SAFETY',
      'RECITATION',
      'LANGUAGE',
      'OTHER',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
      'MALFORMED_FUNCTION_CALL',
      'UNEXPECTED_TOOL_CALL',
      'TOO_MANY_TOOL_CALLS',
      'FINISH_REASON_UNSPECIFIED',
      '',
      null,
      0,
    ].map((reason) => [String(reason), chunk([{ text: secret }], reason)] as [string, unknown]),
    ['prompt block', { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: secret } }],
    ['prompt blocked rating', { promptFeedback: { safetyRatings: [{ blocked: true }] } }],
    [
      'candidate blocked',
      { candidates: [{ ...stop(secret).candidates[0], safetyRatings: [{ blocked: true }] }] },
    ],
    ['root refusal', { ...stop(secret), refusal: secret }],
    ['candidate refusal', { candidates: [{ ...stop(secret).candidates[0], refusal: secret }] }],
    ['server error', { error: { code: 400, message: secret }, ...stop(secret) }],
    ...[
      'functionCall',
      'functionResponse',
      'executableCode',
      'codeExecutionResult',
      'inlineData',
      'fileData',
      'refusal',
      'toolCall',
    ].map(
      (key) =>
        [key, chunk([{ text: secret }, { [key]: { private: secret } }], 'STOP')] as [
          string,
          unknown,
        ],
    ),
    ['thought function call', chunk([{ thought: true, functionCall: { name: secret } }], 'STOP')],
    ['thought refusal', chunk([{ thought: true, refusal: secret }], 'STOP')],
  ];
  for (const [name, event] of events)
    await t.test(name, async () => {
      const seen: string[] = [];
      await assert.rejects(runSSE(frame(event), { onText: (v) => seen.push(v) }), redacted);
      assert.deepEqual(seen, []);
    });
});

test('Gemini candidate cardinality, index, identity and role remain consistent across the entire stream', async (t) => {
  const malformed: [string, unknown][] = [
    [
      'multiple',
      { candidates: [stop('x').candidates[0], { ...stop('x').candidates[0], index: 1 }] },
    ],
    ['duplicate zero', { candidates: [stop('x').candidates[0], stop('x').candidates[0]] }],
    ...[1, -1, 0.5, '0', null].map(
      (index) =>
        [`index ${index}`, { candidates: [{ ...stop('x').candidates[0], index }] }] as [
          string,
          unknown,
        ],
    ),
    ['null candidate', { candidates: [null] }],
    ['object candidates', { candidates: {} }],
    [
      'wrong role',
      {
        candidates: [
          { index: 0, content: { role: 'user', parts: [{ text: 'x' }] }, finishReason: 'STOP' },
        ],
      },
    ],
    ['switched response', { ...stop('x'), responseId: 'r-other' }],
    ['switched model', { ...stop('x'), modelVersion: 'other-model' }],
    ['invalid response', { ...stop('x'), responseId: null }],
    ['empty model', { ...stop('x'), modelVersion: '' }],
  ];
  for (const [name, event] of malformed)
    await t.test(name, async () => {
      await assert.rejects(runSSE(frame(text('partial')) + frame(event)), redacted);
    });
});

test('Gemini rejects truncated streams, malformed JSON/UTF8 and invalid output shapes', async (t) => {
  const payloads: [string, string | Buffer][] = [
    ['EOF without STOP', frame(text('partial'))],
    ['empty stream', ''],
    ['thought only', frame(chunk([{ text: secret, thought: true }], 'STOP'))],
    ['empty STOP', frame(stop())],
    ['blank text STOP', frame(stop(' \n '))],
    ['DONE without STOP', frame(text('partial')) + 'data: [DONE]\n\n'],
    ['unterminated STOP frame', frame(stop('x')).trimEnd()],
    ['truncated JSON', 'data: {"private":"' + secret + '\n\n'],
    ['malformed JSON', 'data: ' + secret + '\n\n'],
    ['array JSON', frame([])],
    ['null JSON', frame(null)],
    ['empty event JSON', frame({})],
    ['no parts', frame({ candidates: [{ index: 0, content: {}, finishReason: 'STOP' }] })],
    ['non-string text', frame(chunk([{ text: 123 }], 'STOP'))],
    ['null text', frame(chunk([{ text: null }], 'STOP'))],
    ['null part', frame(chunk([null], 'STOP'))],
    ['empty part', frame(chunk([{}], 'STOP'))],
    ['invalid thought', frame(chunk([{ text: secret, thought: 'true' }], 'STOP'))],
    ['invalid signature', frame(chunk([{ text: secret, thoughtSignature: {} }], 'STOP'))],
    ['empty signature', frame(chunk([{ text: secret, thoughtSignature: '' }], 'STOP'))],
    [
      'invalid rating',
      frame({ ...stop('x'), promptFeedback: { safetyRatings: [{ blocked: 'true' }] } }),
    ],
    ['invalid feedback', frame({ ...stop('x'), promptFeedback: null })],
    ['invalid metadata', frame({ ...stop('x'), usageMetadata: [] })],
    ['named error event', 'event: error\ndata: ' + JSON.stringify({ message: secret }) + '\n\n'],
    ['unknown named event', 'event: other\n' + frame(stop(secret))],
    [
      'bad UTF8',
      Buffer.concat([
        Buffer.from('data: {"private":"'),
        Buffer.from([0xff]),
        Buffer.from('"}\n\n'),
      ]),
    ],
    [
      'truncated UTF8 at EOF',
      Buffer.concat([Buffer.from(frame(stop('x'))), Buffer.from([0xe4, 0xb8])]),
    ],
  ];
  for (const [name, payload] of payloads)
    await t.test(name, async () => {
      await assert.rejects(runSSE(payload), redacted);
    });
});

test('Gemini does not treat STOP as permission to discard trailing errors, identity changes or candidates', async (t) => {
  const tails = [
    frame(text('replay')),
    frame(stop()),
    frame({ error: { message: secret } }),
    frame({ responseId: 'different', usageMetadata: {} }),
    frame({ modelVersion: 'different', usageMetadata: {} }),
    frame({ promptFeedback: { blockReason: 'SAFETY' } }),
    'data: [DONE]\n\n',
    'data: {',
  ];
  for (const [i, tail] of tails.entries())
    await t.test(String(i), async () => {
      await assert.rejects(runSSE(frame(stop('partial')) + tail), redacted);
    });
});

test('Gemini response byte and visible-text limits include ignored and trailing data', async (t) => {
  await t.test('700000 characters accepted', async () => {
    assert.equal((await runSSE(frame(stop('x'.repeat(700_000))))).length, 700_000);
  });
  await t.test('700001 characters rejected before callback', async () => {
    let calls = 0;
    await assert.rejects(
      runSSE(frame(stop('x'.repeat(700_001))), {
        onText: () => {
          calls++;
        },
      }),
      /过长/,
    );
    assert.equal(calls, 0);
  });
  await t.test('cumulative text cap', async () => {
    await assert.rejects(
      runSSE(frame(text('x'.repeat(400_000))) + frame(stop('x'.repeat(300_001)))),
      /过长/,
    );
  });
  await t.test('thoughts do not count toward visible cap', async () => {
    assert.equal(
      await runSSE(
        frame(chunk([{ text: 'x'.repeat(800_000), thought: true }])) + frame(stop('ok')),
      ),
      'ok',
    );
  });
  for (const [name, payload] of [
    ['oversized comment', ':' + 'x'.repeat(4_000_000)],
    ['oversized thought', frame(chunk([{ text: 'x'.repeat(4_000_000), thought: true }], 'STOP'))],
    ['oversized trailing data', frame(stop('ok')) + ':' + 'x'.repeat(4_000_000)],
  ])
    await t.test(name, async () => {
      await assert.rejects(runSSE(payload), /大小限制/);
    });
});

test('Gemini HTTP failures are redacted; redirects never forward credentials', async (t) => {
  let leaked = 0;
  const sink = await local((res) => {
    leaked++;
    res.end('PRIVATE');
  });
  try {
    for (const status of [301, 302, 303, 307, 308, 400, 401, 403, 429, 500, 503])
      await t.test(String(status), async () => {
        const service = await local((res) => {
          res.writeHead(status, { location: sink.endpoint });
          res.end('PRIVATE ' + secret);
        });
        try {
          await assert.rejects(
            streamGemini({ ...options, endpoint: service.endpoint }),
            (error) => {
              redacted(error);
              assert.match(
                (error as Error).message,
                status === 401 || status === 403 ? /认证失败/ : status === 429 ? /限流/ : /HTTP/,
              );
              return true;
            },
          );
        } finally {
          await service.close();
        }
      });
    assert.equal(leaked, 0);
  } finally {
    await sink.close();
  }
});

test('Gemini requires an exact SSE media type and redacts connection failures', async (t) => {
  for (const type of [
    undefined,
    'application/json',
    'text/html',
    'text/event-stream-evil',
    'text/plain; x=text/event-stream',
  ])
    await t.test(String(type), async () => {
      const service = await local((res) => {
        res.writeHead(200, type ? { 'content-type': type } : {});
        res.end('PRIVATE ' + secret);
      });
      try {
        await assert.rejects(
          streamGemini({ ...options, endpoint: service.endpoint }),
          /未返回 SSE/,
        );
      } finally {
        await service.close();
      }
    });
  const closed = await local((res) => {
    res.end();
  });
  await closed.close();
  await assert.rejects(streamGemini({ ...options, endpoint: closed.endpoint }), redacted);
});

test('Gemini cancellation, timeout, pre-abort and stalled-after-STOP never return partial results', async (t) => {
  await t.test('pre-aborted signal sends no request', async () => {
    const controller = new AbortController();
    controller.abort(secret);
    const service = await local((res) => {
      res.end();
    });
    try {
      await assert.rejects(
        streamGemini({ ...options, endpoint: service.endpoint, signal: controller.signal }),
        /已取消/,
      );
      assert.equal(service.requests.length, 0);
    } finally {
      await service.close();
    }
  });
  await t.test('cancel inside callback cancels socket and excludes following text', async () => {
    const controller = new AbortController();
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const service = await local((res) => {
      res.on('close', closed);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(frame(chunk([{ text: 'partial' }, { text: 'not-to-publish' }])));
    });
    try {
      const seen: string[] = [];
      await assert.rejects(
        streamGemini({
          ...options,
          endpoint: service.endpoint,
          signal: controller.signal,
          onText: (value) => {
            seen.push(value);
            controller.abort(secret);
          },
        }),
        /已取消/,
      );
      assert.deepEqual(seen, ['partial']);
      await Promise.race([
        disconnected,
        delay(1000).then(() => {
          throw new Error('socket not closed');
        }),
      ]);
    } finally {
      await service.close();
    }
  });
  for (const mode of ['before-headers', 'partial', 'thought-only', 'after-STOP'])
    await t.test(mode, async () => {
      const service = await local((res) => {
        if (mode === 'before-headers') return;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          frame(
            mode === 'after-STOP'
              ? stop('x')
              : mode === 'thought-only'
                ? chunk([{ text: secret, thought: true }])
                : text('partial'),
          ),
        );
      });
      try {
        await assert.rejects(
          streamGemini({ ...options, endpoint: service.endpoint, timeoutMs: 80 }),
          /等待时间/,
        );
      } finally {
        await service.close();
      }
    });
});

test('Gemini rejects misplaced tool/refusal fields instead of treating them as harmless metadata', async (t) => {
  for (const field of [
    'tools',
    'functionCall',
    'functionResponse',
    'executableCode',
    'codeExecutionResult',
    'groundingMetadata',
    'urlContextMetadata',
  ]) {
    for (const location of ['response', 'candidate', 'content'])
      await t.test(`${location}.${field}`, async () => {
        const event = stop('PRIVATE TEXT') as Record<string, unknown>;
        const candidate = (event.candidates as Record<string, unknown>[])[0];
        const target =
          location === 'response'
            ? event
            : location === 'candidate'
              ? candidate
              : (candidate.content as Record<string, unknown>);
        target[field] = { message: secret };
        const seen: string[] = [];
        await assert.rejects(runSSE(frame(event), { onText: (v) => seen.push(v) }), redacted);
        assert.deepEqual(seen, []);
      });
  }
  await assert.rejects(
    runSSE(
      frame({
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ text: secret }], refusal: secret },
            finishReason: 'STOP',
          },
        ],
      }),
    ),
    redacted,
  );
});

test('Gemini detects transport truncation and remote stream errors delivered after a separate STOP read', async () => {
  const broken = await local(async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(frame(text('partial')));
    await delay(10);
    res.destroy(new Error(secret));
  });
  try {
    await assert.rejects(streamGemini({ ...options, endpoint: broken.endpoint }), redacted);
  } finally {
    await broken.close();
  }
  const late = await local(async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(frame(stop('partial')));
    await delay(20);
    res.end(frame({ error: { message: secret } }));
  });
  try {
    await assert.rejects(streamGemini({ ...options, endpoint: late.endpoint }), redacted);
  } finally {
    await late.close();
  }
});
