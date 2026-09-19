import { createServer } from 'node:http';
export type DeltaMode =
  | 'normal'
  | 'metadata'
  | 'wrong-index'
  | 'wrong-type'
  | 'truncated'
  | 'unsigned'
  | 'invalid-score'
  | 'no-signature'
  | 'stop-wrong-index'
  | 'wrapped'
  | 'unsigned-wrapped'
  | 'invalid-json'
  | 'multiple-json'
  | 'unsigned-truncated'
  | 'unsigned-limit'
  | 'unsigned-invalid-score'
  | 'schema-required'
  | 'schema-rejected'
  | 'unknown-source'
  | 'json-trailing-comma'
  | 'json-controls'
  | 'json-comments'
  | 'json-combined'
  | 'json-ambiguous'
  | 'json-normalized-invalid-score';
/** Synthetic local transport. No recorded user responses, keys or websites. */
export async function anthropicScoreFixture() {
  let mode: DeltaMode = 'metadata';
  const requests: Record<string, any>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      if (mode === 'schema-rejected') {
        res.writeHead(400);
        res.end('PRIVATE-SCHEMA-ERROR');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (e: Record<string, unknown>) =>
        `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
      const image = JSON.stringify(body.messages).includes('"type":"image"');
      const info = JSON.parse(body.messages[0].content[0].text);
      const imageSource = info.allowedVisualPages?.[0] ?? 'paste';
      const result = {
        dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
          key,
          score: key === 'visual' && !image ? null : 80,
          evidence:
            key === 'visual' && !image
              ? []
              : [
                  {
                    sourceId: key === 'visual' ? imageSource : 'paste',
                    quote:
                      mode === 'invalid-score' ||
                      mode === 'unsigned-invalid-score' ||
                      mode === 'json-normalized-invalid-score'
                        ? 'PRIVATE-INVALID-QUOTE'
                        : 'TypeScript',
                  },
                ],
          issues: [],
          suggestions: ['**成果**：补充真实可核实数字'],
          example: null,
        })),
        summary: 'Native score fixture',
        coveredPages: image ? [imageSource] : [],
        unreadablePages: [],
        conflicts: [],
      };
      if (mode === 'unknown-source')
        result.dimensions[3].evidence.push(
          { sourceId: 'paste', quote: 'TypeScript' },
          { sourceId: 'PRIVATE-NOT-SENT', quote: 'TypeScript' },
        );
      if (mode === 'json-controls' || mode === 'json-combined')
        result.summary = 'Native score fixture\nSecond line\tIndented\rReturn';
      let text = JSON.stringify(result);
      if (
        mode === 'json-trailing-comma' ||
        mode === 'json-combined' ||
        mode === 'json-normalized-invalid-score'
      )
        text = text.slice(0, -1) + ',}';
      if (mode === 'json-controls' || mode === 'json-combined')
        text = text.replaceAll('\\n', '\n').replaceAll('\\t', '\t').replaceAll('\\r', '\r');
      if (mode === 'json-comments' || mode === 'json-combined')
        text = text.replace('{', '{/* PRIVATE-COMMENT */\n');
      if (mode === 'json-ambiguous') text = text.replace(',"summary"', ' "summary"');
      if (mode.startsWith('json-')) text = '```json\n' + text + '\n```';
      if (mode === 'schema-required' && !body.output_config) text = '{"PRIVATE":';
      if (mode === 'wrapped' || mode === 'unsigned-wrapped')
        text = '以下是结果：\n```json\n' + text + '\n```\n请参考建议。';
      if (mode === 'invalid-json') text = '{"PRIVATE":';
      if (mode === 'multiple-json') text += text;
      const frames: Record<string, unknown>[] = [
        {
          type: 'message_start',
          message: {
            id: 'local-fixture',
            type: 'message',
            role: 'assistant',
            content: [],
            stop_reason: null,
          },
        },
      ];
      const thinking =
        mode === 'metadata' || mode.startsWith('unsigned') || mode === 'no-signature';
      if (thinking) {
        frames.push(
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'PRIVATE-THINKING' },
          },
        );
        if (mode !== 'no-signature')
          frames.push({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: '' },
          });
        if (mode === 'metadata')
          frames.push({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'PRIVATE-SIGNATURE' },
          });
        frames.push({ type: 'content_block_stop', index: 0 });
      }
      const index = thinking ? 1 : 0;
      frames.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      frames.push({
        type: 'content_block_delta',
        index: mode === 'wrong-index' ? index + 1 : index,
        delta:
          mode === 'wrong-type'
            ? { type: 'thinking_delta', thinking: 'PRIVATE-WRONG-TYPE' }
            : { type: 'text_delta', text },
      });
      if (mode === 'metadata')
        frames.push({
          type: 'content_block_delta',
          index,
          delta: {
            type: 'citations_delta',
            citation: {
              type: 'char_location',
              document_index: 0,
              document_title: null,
              start_char_index: 0,
              end_char_index: 10,
              cited_text: 'PRIVATE-CITATION',
            },
          },
        });
      frames.push(
        { type: 'content_block_stop', index: mode === 'stop-wrong-index' ? index + 1 : index },
        {
          type: 'message_delta',
          delta: { stop_reason: mode === 'unsigned-limit' ? 'max_tokens' : 'end_turn' },
        },
      );
      if (mode !== 'truncated' && mode !== 'unsigned-truncated')
        frames.push({ type: 'message_stop' });
      res.end(frames.map(frame).join(''));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setMode: (v: DeltaMode) => {
      mode = v;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
