import { createServer, type IncomingHttpHeaders } from 'node:http';
export type NativeMode =
  | 'success'
  | 'compatible'
  | 'slow'
  | 'incomplete'
  | 'failed'
  | 'refusal'
  | 'truncated'
  | 'unauthorized'
  | 'invalid';
export type NativeProtocol = 'gemini' | 'anthropic';
export interface NativeRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, any>;
}
/** Accepts only the native wire shape at each endpoint. Never contacts a remote API. */
export async function nativeFixture(reply?: (input: string) => string) {
  let mode: NativeMode = 'success';
  const requests: NativeRequest[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      let body: Record<string, any>;
      try {
        body = JSON.parse(raw);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const path = request.url ?? '';
      requests.push({ path, body, headers: request.headers });
      const gemini = /\/models\/[^/]+:streamGenerateContent\?alt=sse$/.test(path);
      const anthropic = path.endsWith('/messages');
      const wrong =
        request.method !== 'POST' ||
        request.headers.authorization ||
        body.tools ||
        body.background ||
        body.previous_response_id ||
        (gemini
          ? !request.headers['x-goog-api-key'] ||
            !body.contents ||
            body.messages ||
            body.model ||
            body.stream !== undefined
          : !anthropic ||
            !request.headers['x-api-key'] ||
            request.headers['anthropic-version'] !== '2023-06-01' ||
            !body.messages ||
            !body.model ||
            !body.max_tokens ||
            body.stream !== true ||
            body.contents);
      if (wrong) {
        response.writeHead(400).end('NATIVE-WIRE-ERROR');
        return;
      }
      if (mode === 'unauthorized') {
        response.writeHead(401).end('PRIVATE-NATIVE-ERROR');
        return;
      }
      const serialized = JSON.stringify(gemini ? body.contents : body.messages);
      const image = serialized.includes('inlineData') || serialized.includes('"type":"image"');
      const probe = serialized.includes('Reply with only OK.');
      const text = reply
        ? reply(serialized)
        : image
          ? 'red'
          : probe
            ? 'OK'
            : mode === 'invalid'
              ? 'not-json'
              : JSON.stringify({
                  document: serialized.includes('refine')
                    ? '# 原生协议调整正文'
                    : '# 原生协议生成正文',
                  suggestions: '排版建议',
                  rationale: '设计说明',
                });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const data = (value: unknown) => response.write('data: ' + JSON.stringify(value) + '\n\n');
      const event = (value: Record<string, unknown>) =>
        response.write('event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n');
      if (mode === 'failed') {
        if (gemini) data({ error: { code: 500, message: 'PRIVATE-NATIVE-ERROR' } });
        else
          event({ type: 'error', error: { type: 'api_error', message: 'PRIVATE-NATIVE-ERROR' } });
        response.end();
        return;
      }
      const chunk = mode === 'slow' ? '尚未完成的原生协议内容' : text;
      if (gemini) {
        if (mode === 'refusal') {
          data({ promptFeedback: { blockReason: 'SAFETY' } });
          response.end();
          return;
        }
        data({
          responseId: 'native-response',
          candidates: [
            {
              ...(mode === 'compatible' ? {} : { index: 0 }),
              content: { role: 'model', parts: [{ text: chunk }] },
            },
          ],
        });
        if (mode === 'slow') return;
        if (mode !== 'truncated')
          data({
            responseId: 'native-response',
            candidates: [
              {
                ...(mode === 'compatible' ? {} : { index: 0 }),
                finishReason: mode === 'incomplete' ? 'MAX_TOKENS' : 'STOP',
              },
            ],
          });
      } else {
        event({
          type: 'message_start',
          message: {
            id: 'native-message',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        });
        if (mode === 'compatible') {
          event({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' },
          });
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'PRIVATE-SIGNATURE' },
          });
          event({ type: 'content_block_stop', index: 0 });
        }
        const textIndex = mode === 'compatible' ? 1 : 0;
        event({
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: mode === 'compatible' ? chunk.slice(0, 1) : '' },
        });
        event({
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: mode === 'compatible' ? chunk.slice(1) : chunk },
        });
        if (mode === 'slow') return;
        if (mode !== 'truncated') {
          event({ type: 'content_block_stop', index: textIndex });
          if (mode === 'compatible')
            event({ type: 'message_delta', delta: {}, usage: { output_tokens: 29 } });
          event({
            type: 'message_delta',
            delta: {
              stop_reason:
                mode === 'incomplete' ? 'max_tokens' : mode === 'refusal' ? 'refusal' : 'end_turn',
              stop_sequence: null,
            },
            usage: { output_tokens: 30 },
          });
          event({ type: 'message_stop' });
        }
      }
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
  return {
    requests,
    baseUrl: (protocol: NativeProtocol) =>
      origin + (protocol === 'gemini' ? '/proxy/v1beta' : '/proxy/v1'),
    setMode: (value: NativeMode) => {
      mode = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
