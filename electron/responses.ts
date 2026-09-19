import { completionDiagnostic } from '../shared/diagnostics';
import { httpAiError } from '../shared/ai.js';
import { AiError } from '../shared/ai.js';
import { wireParameters } from '../shared/models.js';
import type { streamChat } from './chat-completions.js';
type Options = Parameters<typeof streamChat>[0];
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiError('Responses 响应流格式无效，未保存不完整结果。');
  return value as RecordValue;
}

export function responsesBody(options: Pick<Options, 'modelId' | 'messages' | 'parameters'>) {
  return {
    model: options.modelId,
    input: options.messages.map(({ role, content }) => ({
      role,
      content:
        typeof content === 'string'
          ? [{ type: 'input_text', text: content }]
          : content.map((part) =>
              part.type === 'text'
                ? { type: 'input_text', text: part.text }
                : { type: 'input_image', image_url: part.image_url.url, detail: 'auto' },
            ),
    })),
    stream: true,
    store: false,
    ...wireParameters(options.parameters ?? {}, 'responses'),
  };
}

/** A completed response, not a text.done event or [DONE], authorizes persistence. */
export class ResponsesStream {
  private deltas = new Map<string, string>();
  private responseId: string | null = null;
  private sequence = -1;
  private size = 0;
  result: string | null = null;
  constructor(private onText: (text: string) => void) {}
  frame(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') throw new AiError('Responses 未收到完整完成事件，原有内容保持不变。');
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      throw new AiError('Responses 响应流 JSON 损坏，未保存结果。');
    }
    const event = object(raw);
    if (typeof event.type !== 'string') throw new AiError('Responses 流事件缺少类型。');
    const named = frame
      .split(/\r?\n/)
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    if (named && named !== event.type) throw new AiError('Responses 流事件类型不一致。');
    if (event.sequence_number !== undefined) {
      if (
        !Number.isSafeInteger(event.sequence_number) ||
        (event.sequence_number as number) <= this.sequence
      )
        throw new AiError('Responses 流事件顺序无效，未保存结果。');
      this.sequence = event.sequence_number as number;
    }
    if (event.type === 'error' || event.type === 'response.failed')
      throw new AiError('Responses 服务在生成过程中返回错误，未保存不完整结果。');
    if (event.type === 'response.incomplete') {
      const response = event.response === undefined ? {} : object(event.response);
      const details =
        response.incomplete_details == null ? {} : object(response.incomplete_details);
      const limited = details.reason === 'max_output_tokens';
      const diagnostic = completionDiagnostic('Responses', limited ? 'limit' : 'incomplete');
      throw new AiError(diagnostic.message, diagnostic);
    }
    if (event.type.startsWith('response.refusal.'))
      throw new AiError('模型拒绝了本次请求，未生成正式版本。');
    if (
      event.type === 'response.created' ||
      event.type === 'response.in_progress' ||
      event.type === 'response.completed'
    ) {
      const response = object(event.response);
      if (typeof response.id !== 'string' || !response.id)
        throw new AiError('Responses 缺少响应标识。');
      if (this.responseId && this.responseId !== response.id)
        throw new AiError('Responses 响应标识不一致。');
      this.responseId = response.id;
      if (event.type === 'response.completed') this.complete(response);
    } else if (event.type === 'response.output_text.delta') {
      if (
        typeof event.delta !== 'string' ||
        !Number.isSafeInteger(event.output_index) ||
        !Number.isSafeInteger(event.content_index) ||
        (event.output_index as number) < 0 ||
        (event.content_index as number) < 0
      )
        throw new AiError('Responses 正文增量格式无效。');
      const key = `${event.output_index}:${event.content_index}`;
      this.size += event.delta.length;
      if (this.size > 700_000) throw new AiError('输出过长，已停止请求。');
      this.deltas.set(key, (this.deltas.get(key) ?? '') + event.delta);
      this.onText(event.delta);
    } else if (
      event.type === 'response.output_item.added' ||
      event.type === 'response.output_item.done'
    ) {
      const item = object(event.item);
      if (!['message', 'reasoning'].includes(String(item.type)))
        throw new AiError('本阶段不支持 Responses 工具或其他非正文输出，未保存版本。');
    } else if (
      event.type === 'response.content_part.added' ||
      event.type === 'response.content_part.done'
    ) {
      if (object(event.part).type === 'refusal')
        throw new AiError('模型拒绝了本次请求，未生成正式版本。');
    }
  }
  private complete(response: RecordValue) {
    if (
      response.status !== 'completed' ||
      response.error ||
      response.incomplete_details ||
      !Array.isArray(response.output)
    )
      throw new AiError('Responses 完成状态无效或输出不完整，未保存版本。');
    let text = '';
    const matched = new Set<string>();
    for (const [outputIndex, raw] of response.output.entries()) {
      const item = object(raw);
      if (item.type === 'reasoning') continue;
      if (
        item.type !== 'message' ||
        item.role !== 'assistant' ||
        item.status !== 'completed' ||
        !Array.isArray(item.content)
      )
        throw new AiError('Responses 包含未完成消息或不支持的工具输出，未保存版本。');
      for (const [contentIndex, rawPart] of item.content.entries()) {
        const part = object(rawPart);
        if (part.type === 'refusal') throw new AiError('模型拒绝了本次请求，未生成正式版本。');
        if (part.type !== 'output_text' || typeof part.text !== 'string')
          throw new AiError('Responses 正文格式无效。');
        const key = `${outputIndex}:${contentIndex}`;
        if (this.deltas.has(key) && this.deltas.get(key) !== part.text)
          throw new AiError('Responses 正文增量与最终内容不一致，未保存版本。');
        matched.add(key);
        text += part.text;
      }
    }
    if ([...this.deltas.keys()].some((key) => !matched.has(key)) || !text.trim())
      throw new AiError('Responses 没有完整的正文输出，未保存版本。');
    if (text.length > 700_000) throw new AiError('输出过长，已停止请求。');
    if (!this.deltas.size) this.onText(text);
    this.result = text;
  }
}

export async function streamResponses(options: Options): Promise<string> {
  const body = responsesBody(options);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = AbortSignal.any([options.signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpAiError(response.status);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new AiError('服务未返回 SSE 流，请检查 Responses 兼容性。');
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stream = new ResponsesStream(options.onText);
    let pending = '',
      bytes = 0;
    while (stream.result === null) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 4_000_000) throw new AiError('响应超过大小限制，已停止请求。');
      pending += decoder.decode(chunk.value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        stream.frame(frame);
        if (stream.result !== null) break;
      }
    }
    signal.throwIfAborted();
    if (stream.result === null)
      throw new AiError('Responses 流提前结束，未收到 response.completed，原有内容保持不变。');
    return stream.result;
  } catch (error) {
    if (options.signal.aborted) throw new AiError('已取消，本次不创建版本，旧内容保持不变。');
    if (timeout.aborted) throw new AiError('请求超过等待时间，未保存不完整结果。');
    if (error instanceof AiError) throw error;
    throw new AiError(
      'Responses 网络连接失败或响应编码无效，请检查服务地址与网络。原有内容保持不变。',
    );
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
