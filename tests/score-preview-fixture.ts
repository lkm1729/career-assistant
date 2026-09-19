import { createServer } from 'node:http';
export const SCORE_FIXTURE_KEY = 'FAKE-SCORE-PREVIEW-KEY';
export const SCORE_INVALID_BODY = `{"summary":"LOCAL PRIVATE-CONTENT ${SCORE_FIXTURE_KEY} "unescaped text","dimensions":[]}`;
export const SCORE_VALID_BODY = JSON.stringify({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
    key,
    score: key === 'visual' ? null : 80,
    evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'TypeScript' }],
    issues: [],
    suggestions: [],
    example: null,
  })),
  summary: 'Synthetic valid score',
  coveredPages: [],
  unreadablePages: [],
  conflicts: [],
});
const missingDimensionBody = JSON.parse(SCORE_VALID_BODY);
missingDimensionBody.dimensions.pop();
missingDimensionBody.summary = 'PRIVATE-CONTENT ' + SCORE_FIXTURE_KEY;
export const SCORE_DIMENSIONS_BODY = JSON.stringify(missingDimensionBody);
export async function scorePreviewFixture(
  protocol: 'chat-completions' | 'anthropic',
  validBody = SCORE_VALID_BODY,
) {
  let mode: 'invalid' | 'valid' | 'http-failure' | 'truncated' | 'evidence' | 'dimensions' =
    'invalid';
  const requests: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      if (mode === 'http-failure') {
        res.writeHead(503);
        res.end('SYNTHETIC HTTP FAILURE');
        return;
      }
      const text =
        mode === 'valid'
          ? validBody
          : mode === 'evidence'
            ? validBody.replaceAll('TypeScript', 'NOT IN SOURCE')
            : mode === 'dimensions'
              ? SCORE_DIMENSIONS_BODY
              : SCORE_INVALID_BODY;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (protocol === 'chat-completions') {
        for (let i = 0; i < text.length; i += 17)
          res.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 17) }, finish_reason: null }] })}\n\n`,
          );
        if (mode !== 'truncated')
          res.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          );
        res.end();
        return;
      }
      const send = (event: Record<string, unknown>) =>
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      send({
        type: 'message_start',
        message: {
          id: 'synthetic',
          type: 'message',
          role: 'assistant',
          model: 'synthetic',
          content: [],
          stop_reason: null,
        },
      });
      send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 17)
        send({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: text.slice(i, i + 17) },
        });
      send({ type: 'content_block_stop', index: 0 });
      if (mode !== 'truncated') {
        send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
        send({ type: 'message_stop' });
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setMode(next: typeof mode) {
      mode = next;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
