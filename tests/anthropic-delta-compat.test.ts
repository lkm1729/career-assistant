import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { AnthropicStream, streamAnthropic } from '../electron/anthropic';
import { AiError } from '../shared/ai';
import { parseScore } from '../electron/scoring';
type E = Record<string, unknown>;
const frame = (e: E) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const start: E = {
  type: 'message_start',
  message: { id: 'fixture', role: 'assistant', type: 'message', content: [], stop_reason: null },
};
const block = (index = 0, type = 'text'): E => ({
  type: 'content_block_start',
  index,
  content_block: type === 'thinking' ? { type, thinking: '' } : { type, text: '' },
});
const delta = (d: E, index = 0): E => ({ type: 'content_block_delta', index, delta: d });
const stop = (index = 0): E => ({ type: 'content_block_stop', index });
const end: E[] = [
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];
const text = (value: string, index = 0) => delta({ type: 'text_delta', text: value }, index);
const citation: E = {
  type: 'char_location',
  document_index: 0,
  document_title: null,
  start_char_index: 0,
  end_char_index: 3,
  cited_text: 'PRIVATE-CITATION',
};
const scoreText = JSON.stringify({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
    key,
    score: key === 'visual' ? null : 80,
    evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'TypeScript' }],
    issues: [],
    suggestions: ['**成果**：补充真实数字'],
  })),
  summary: 'Fictional score',
  coveredPages: [],
  unreadablePages: [],
  conflicts: [],
});
function parse(events: E[]) {
  let preview = '';
  const parser = new AnthropicStream((t) => {
    preview += t;
  });
  events.forEach((e) => parser.frame(frame(e)));
  return { parser, preview };
}

test('text citations metadata must not reject or contaminate a complete score', () => {
  const { parser, preview } = parse([
    start,
    block(),
    text(scoreText),
    delta({ type: 'citations_delta', citation }),
    stop(),
    ...end,
  ]);
  assert.equal(parser.result, scoreText);
  assert.equal(preview, scoreText);
  assert.equal(
    parseScore(
      parser.result!,
      { revision: 'fixture', items: [], warnings: [], imageCount: 0, textCount: 10 },
      'TypeScript',
    ).dimensions[0].score,
    80,
  );
});
test('empty signature metadata is discarded; text and message completion are still required', () => {
  const events = [
    start,
    block(0, 'thinking'),
    delta({ type: 'thinking_delta', thinking: 'PRIVATE-THINKING' }),
    delta({ type: 'signature_delta', signature: '' }),
    delta({ type: 'signature_delta', signature: 'PRIVATE-SIGNATURE' }),
    stop(),
    block(1),
    text(scoreText, 1),
    stop(1),
    ...end,
  ];
  const { parser, preview } = parse(events);
  assert.equal(parser.result, scoreText);
  assert.equal(preview, scoreText);
  const emptySignature = parse([
    start,
    block(0, 'thinking'),
    delta({ type: 'signature_delta', signature: '' }),
    stop(),
    block(1),
    text(scoreText, 1),
    stop(1),
    ...end,
  ]);
  assert.equal(emptySignature.parser.result, scoreText);
  assert.equal(emptySignature.preview, scoreText);
  assert.throws(
    () =>
      parse([
        start,
        block(0, 'thinking'),
        delta({ type: 'signature_delta', signature: '' }),
        delta({ type: 'thinking_delta', thinking: 'late' }),
      ]),
    AiError,
  );
});
test('delta rejection reports fixed reason and safe shape, never remote values or keys', () => {
  const cases: [E[], string][] = [
    [[start, block(), text('PRIVATE', 1)], 'INDEX_MISMATCH'],
    [[start, text('PRIVATE')], 'NO_ACTIVE_BLOCK'],
    [[start, block(), delta({ type: 'text_delta', text: null })], 'TEXT_TYPE'],
    [
      [start, block(), delta({ type: 'thinking_delta', thinking: 'PRIVATE' })],
      'BLOCK_TYPE_MISMATCH',
    ],
    [
      [start, block(), delta({ type: 'PRIVATE-SECRET-TYPE', text: 'PRIVATE-KEY' })],
      'UNKNOWN_DELTA_TYPE',
    ],
    [[start, block(), delta({ type: 'citations_delta', citation: null })], 'CITATION_SHAPE'],
    [[start, block(), { type: 'content_block_delta', index: 0, delta: null }], 'DELTA_OBJECT'],
    [
      [
        start,
        block(),
        {
          type: 'content_block_delta',
          index: 'PRIVATE-INDEX',
          delta: { type: 'text_delta', text: 'PRIVATE' },
        },
      ],
      'INDEX_TYPE',
    ],
  ];
  for (const [events, reason] of cases) {
    assert.throws(
      () => parse(events),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.diagnostic?.code, 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA');
        const json = JSON.stringify(error.diagnostic);
        assert.match(json, new RegExp(reason));
        assert.match(json, /block=/);
        assert.doesNotMatch(json, /PRIVATE|127\.0\.0\.1/);
        return true;
      },
    );
  }
});
test('metadata cannot replace text or weaken lifecycle, refusal and tool rejection', () => {
  for (const events of [
    [start, block(), delta({ type: 'citations_delta', citation }), stop(), ...end],
    [start, block(0, 'thinking'), delta({ type: 'citations_delta', citation })],
    [start, block(), text(scoreText), stop(), delta({ type: 'citations_delta', citation })],
    [start, block(), delta({ type: 'input_json_delta', partial_json: '{}' })],
    [
      start,
      block(),
      text(scoreText),
      stop(),
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      end[1],
    ],
    [
      start,
      block(),
      text(scoreText),
      stop(),
      { type: 'message_delta', delta: { stop_reason: 'refusal' } },
      end[1],
    ],
  ])
    assert.throws(() => parse(events), AiError);
});
test('HTTP transport returns only complete scoring JSON with metadata; truncated stream remains failure', async () => {
  let truncated = false;
  const events = [
    start,
    block(0, 'thinking'),
    delta({ type: 'signature_delta', signature: '' }),
    delta({ type: 'signature_delta', signature: 'PRIVATE-SIGNATURE' }),
    stop(),
    block(1),
    text(scoreText.slice(0, 25), 1),
    delta({ type: 'citations_delta', citation }, 1),
    text(scoreText.slice(25), 1),
    stop(1),
    ...end,
  ];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const body = (truncated ? events.slice(0, -1) : events).map(frame).join('');
      res.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const options = {
    endpoint: `http://127.0.0.1:${address.port}/v1/messages`,
    modelId: 'fixture',
    apiKey: 'FAKE-ONLY',
    messages: [{ role: 'user', content: 'synthetic score' }],
    signal: new AbortController().signal,
    onText: () => {},
  };
  try {
    assert.equal(await streamAnthropic(options), scoreText);
    truncated = true;
    await assert.rejects(
      streamAnthropic(options),
      (error: unknown) =>
        error instanceof AiError && error.diagnostic?.code === 'AI_ANTHROPIC_STREAM_END',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

for (const metadata of [
  {
    type: 'page_location',
    document_index: 0,
    document_title: null,
    start_page_number: 1,
    end_page_number: 2,
    cited_text: 'PRIVATE',
  },
  {
    type: 'content_block_location',
    document_index: 0,
    document_title: 'PRIVATE',
    file_id: null,
    start_block_index: 0,
    end_block_index: 1,
    cited_text: 'PRIVATE',
  },
  {
    type: 'search_result_location',
    search_result_index: 0,
    source: 'https://never-fetch.invalid',
    title: null,
    start_block_index: 0,
    end_block_index: 1,
    cited_text: 'PRIVATE',
  },
  {
    type: 'web_search_result_location',
    url: 'https://never-fetch.invalid',
    title: null,
    encrypted_index: 'PRIVATE',
    cited_text: 'PRIVATE',
  },
])
  test('known metadata type is discarded without changing text: ' + metadata.type, () => {
    const { parser, preview } = parse([
      start,
      block(),
      delta({ type: 'citations_delta', citation: metadata }),
      text(scoreText),
      stop(),
      ...end,
    ]);
    assert.equal(parser.result, scoreText);
    assert.equal(preview, scoreText);
  });
test('malformed metadata is rejected rather than interpreted as document text', () => {
  for (const c of [
    { ...citation, document_index: -1 },
    { ...citation, end_char_index: 0 },
    { ...citation, cited_text: 9 },
    { ...citation, document_title: [] },
    { ...citation, type: 'PRIVATE-UNKNOWN' },
    [],
    {
      type: 'page_location',
      document_index: 0,
      start_page_number: 0,
      end_page_number: 1,
      cited_text: 'x',
    },
  ]) {
    assert.throws(
      () =>
        parse([
          start,
          block(),
          delta({ type: 'citations_delta', citation: c }),
          text(scoreText),
          stop(),
          ...end,
        ]),
      (e: unknown) => e instanceof AiError && e.message.includes('CITATION_SHAPE'),
    );
  }
});
test('diagnostic covers signed thinking order and wrong payload types, without raw values', () => {
  for (const [events, reason] of [
    [
      [start, block(0, 'thinking'), delta({ type: 'thinking_delta', thinking: 55 })],
      'THINKING_TYPE',
    ],
    [
      [start, block(0, 'thinking'), delta({ type: 'signature_delta', signature: null })],
      'SIGNATURE_TYPE',
    ],
    [
      [
        start,
        block(0, 'thinking'),
        delta({ type: 'signature_delta', signature: 'PRIVATE' }),
        delta({ type: 'thinking_delta', thinking: 'PRIVATE' }),
      ],
      'THINKING_AFTER_SIGNATURE',
    ],
    [[start, block(), text('x'), stop(), end[0], text('PRIVATE')], 'PHASE'],
  ] as [E[], string][]) {
    assert.throws(
      () => parse(events),
      (e: unknown) =>
        e instanceof AiError && e.message.includes(reason) && !e.message.includes('PRIVATE'),
    );
  }
});
