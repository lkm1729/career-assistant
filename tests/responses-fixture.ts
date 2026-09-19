import { createServer, type ServerResponse } from 'node:http';
export type P05Mode =
  | 'success'
  | 'slow'
  | 'incomplete'
  | 'failed'
  | 'refusal'
  | 'truncated'
  | 'unauthorized'
  | 'invalid';
export interface P05Request {
  path: string;
  authorization?: string;
  body: Record<string, any>;
}
/** Strict local fixture: rejects Chat-shaped payloads at /responses and vice versa. */
export async function responsesFixture(reply?: (input: string) => string) {
  let mode: P05Mode = 'success';
  const requests: P05Request[] = [];
  const pending = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw);
      const path = request.url ?? '';
      requests.push({ path, authorization: request.headers.authorization, body });
      const responses = path.endsWith('/responses');
      if (
        responses
          ? !body.input ||
            body.messages ||
            body.store !== false ||
            body.max_completion_tokens ||
            body.reasoning_effort
          : !body.messages || body.input
      ) {
        response.writeHead(400);
        response.end('Incorrect wire protocol');
        return;
      }
      if (mode === 'unauthorized') {
        response.writeHead(401);
        response.end('PRIVATE-P05-ERROR-DO-NOT-DISPLAY');
        return;
      }
      const input = responses ? body.input : body.messages;
      const textInput = JSON.stringify(input);
      const isProbe = textInput.includes('Reply with only OK.');
      const imageProbe = textInput.includes('input_image') || textInput.includes('image_url');
      const text = reply
        ? reply(textInput)
        : imageProbe
          ? 'red'
          : isProbe
            ? 'OK'
            : mode === 'invalid'
              ? 'bad JSON'
              : JSON.stringify({
                  document: textInput.includes('refine') ? '# P05 调整正文' : '# P05 生成正文',
                  suggestions: 'P05 排版建议',
                  rationale: 'P05 设计说明',
                });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (event: Record<string, unknown>) =>
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (!responses) {
        if (mode === 'slow') {
          response.write(
            'data: ' +
              JSON.stringify({
                choices: [{ index: 0, delta: { content: 'pending' }, finish_reason: null }],
              }) +
              '\n\n',
          );
          pending.add(response);
          response.on('close', () => pending.delete(response));
          return;
        }
        response.end(
          'data: ' +
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: { content: text },
                  finish_reason: mode === 'incomplete' ? 'length' : 'stop',
                },
              ],
            }) +
            '\n\ndata: [DONE]\n\n',
        );
        return;
      }
      frame({ type: 'response.created', response: { id: 'resp-p05', status: 'in_progress' } });
      frame({
        type: 'response.output_text.delta',
        item_id: 'msg-p05',
        output_index: 0,
        content_index: 0,
        delta: mode === 'slow' ? '尚未完成的 Responses 内容' : text,
      });
      if (mode === 'slow') {
        pending.add(response);
        response.on('close', () => pending.delete(response));
        return;
      }
      if (mode === 'truncated') {
        response.end();
        return;
      }
      if (mode === 'failed') {
        frame({
          type: 'response.failed',
          response: {
            id: 'resp-p05',
            status: 'failed',
            error: { message: 'PRIVATE-P05-ERROR-DO-NOT-DISPLAY' },
          },
        });
        response.end();
        return;
      }
      if (mode === 'incomplete') {
        frame({ type: 'response.incomplete', response: { id: 'resp-p05', status: 'incomplete' } });
        response.end();
        return;
      }
      if (mode === 'refusal') {
        frame({ type: 'response.refusal.delta', delta: 'Refused' });
        response.end();
        return;
      }
      frame({
        type: 'response.completed',
        response: {
          id: 'resp-p05',
          status: 'completed',
          error: null,
          incomplete_details: null,
          output: [
            {
              id: 'msg-p05',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text, annotations: [] }],
            },
          ],
        },
      });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/proxy/v1`;
  return {
    baseUrl,
    requests,
    setMode: (next: P05Mode) => {
      mode = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of pending) r.destroy();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
