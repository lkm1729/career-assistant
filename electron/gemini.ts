import { completionDiagnostic } from '../shared/diagnostics';
import { protocolStreamDiagnostic } from '../shared/diagnostics.js';
import { httpAiError } from '../shared/ai.js';
import { AiError } from '../shared/ai.js';
import { validateParameters } from '../shared/models.js';
import type { streamChat } from './chat-completions.js';

type Options = Parameters<typeof streamChat>[0];
type JsonObject = Record<string, unknown>;
type InputPart = { text: string } | { inlineData: { mimeType: string; data: string } };
const invalid = () => new AiError('Gemini 响应流格式无效，未保存不完整结果。');
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as JsonObject;
}

/** The shared layer owns endpoint/model-path validation; no model or key goes in this body. */
export function geminiBody(
  options: Pick<Options, 'messages' | 'parameters' | 'geminiResponseJsonSchema'>,
) {
  if (options.parameters?.reasoningEffort !== undefined)
    throw new AiError('Gemini 本阶段不支持 reasoningEffort，不同模型的思考参数不能直接映射。');
  const parameters = validateParameters(options.parameters ?? {});
  const contents: { role: 'user' | 'model'; parts: InputPart[] }[] = [];
  const systemParts: { text: string }[] = [];
  if (!Array.isArray(options.messages)) throw new AiError('Gemini 消息格式无效。');
  for (const message of options.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role))
      throw new AiError('Gemini 不支持此消息角色或工具消息。');
    const source =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content;
    if (!Array.isArray(source) || source.length === 0)
      throw new AiError('Gemini 消息内容不能为空。');
    const parts: InputPart[] = source.map((raw: unknown): InputPart => {
      const part = object(raw);
      if (part.type === 'text' && typeof part.text === 'string') return { text: part.text };
      if (part.type !== 'image_url' || message.role === 'system')
        throw new AiError('Gemini 仅支持文本与内嵌图片，systemInstruction 仅支持文本。');
      const url = object(part.image_url).url;
      const match =
        typeof url === 'string'
          ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
          : null;
      if (
        !match ||
        match[2].length % 4 !== 0 ||
        Buffer.from(match[2], 'base64').toString('base64') !== match[2]
      )
        throw new AiError(
          'Gemini 图片必须是严格的 data:image/png、jpeg 或 webp;base64，禁止远程图片。',
        );
      return { inlineData: { mimeType: match[1], data: match[2] } };
    });
    if (message.role === 'system') systemParts.push(...(parts as { text: string }[]));
    else contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  if (!contents.length) throw new AiError('Gemini 至少需要一条 user 或 assistant 消息。');
  return {
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    contents,
    generationConfig: {
      candidateCount: 1,
      ...(options.geminiResponseJsonSchema
        ? {
            responseMimeType: 'application/json',
            responseJsonSchema: options.geminiResponseJsonSchema,
          }
        : {}),
      ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
      ...(parameters.maxCompletionTokens === undefined
        ? {}
        : { maxOutputTokens: parameters.maxCompletionTokens }),
    },
  };
}

function checkSafety(value: JsonObject) {
  if (
    [
      'functionCall',
      'functionResponse',
      'executableCode',
      'codeExecutionResult',
      'tools',
      'toolCall',
      'toolCalls',
      'tool_calls',
      'groundingMetadata',
      'urlContextMetadata',
    ].some((key) => value[key] !== undefined)
  )
    throw new AiError('Gemini 本阶段不支持工具或其他非正文输出，未保存版本。');
  if (
    value.refusal !== undefined ||
    (value.blockReason !== undefined && value.blockReason !== 'BLOCK_REASON_UNSPECIFIED')
  )
    throw new AiError('Gemini 拒绝或阻断了本次请求，未保存版本。');
  if (value.safetyRatings !== undefined) {
    if (!Array.isArray(value.safetyRatings)) throw invalid();
    for (const raw of value.safetyRatings) {
      const rating = object(raw);
      if (rating.blocked === true) throw new AiError('Gemini 安全检查阻断了本次请求，未保存版本。');
      if (rating.blocked !== undefined && typeof rating.blocked !== 'boolean') throw invalid();
    }
  }
}

/** Only finish() after EOF authorizes persistence; a STOP does not hide trailing errors. */
export class GeminiStream {
  #text = '';
  #stopped = false;
  #responseId: string | undefined;
  #modelVersion: string | undefined;
  // Preserve signed/thought parts in memory, never in callbacks, results or public properties.
  #markedParts: JsonObject[] = [];
  constructor(private onText: (text: string) => void) {}

  private stage = 'FRAME';
  frame(frame: string) {
    this.stage = 'FRAME';
    try {
      this.readFrame(frame);
    } catch (error) {
      if (!(error instanceof AiError) || error.diagnostic) throw error;
      const diagnostic = protocolStreamDiagnostic('Gemini', this.stage, error.message);
      throw new AiError(diagnostic.message, diagnostic);
    }
  }
  private readFrame(frame: string) {
    const lines = frame.split(/\r\n|\r|\n/);
    const data: string[] = [];
    let event = '';
    for (const line of lines) {
      const colon = line.indexOf(':');
      const name = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (name === 'data') data.push(value);
      if (name === 'event') event = value;
    }
    if (!data.length) return;
    if (event && event !== 'message')
      throw new AiError('Gemini 服务返回错误或不支持的 SSE 事件，未保存版本。');
    let raw: unknown;
    try {
      raw = JSON.parse(data.join('\n'));
    } catch {
      throw new AiError('Gemini 响应流 JSON 损坏或终止标记无效，未保存结果。');
    }
    const value = object(raw);
    if (value.error !== undefined)
      throw new AiError('Gemini 服务在生成过程中返回错误，未保存不完整结果。');
    checkSafety(value);
    if (value.promptFeedback !== undefined) checkSafety(object(value.promptFeedback));
    if (value.usageMetadata !== undefined) object(value.usageMetadata);
    this.stage = 'IDENTITY';
    for (const key of ['responseId', 'modelVersion'] as const) {
      const identity = value[key];
      if (identity === undefined) continue;
      if (typeof identity !== 'string' || !identity.trim())
        throw new AiError('Gemini 响应标识格式无效。');
      const previous = key === 'responseId' ? this.#responseId : this.#modelVersion;
      if (previous !== undefined && previous !== identity)
        throw new AiError('Gemini 响应标识或模型版本不一致，未保存版本。');
      if (key === 'responseId') this.#responseId = identity;
      else this.#modelVersion = identity;
    }
    this.stage = 'CANDIDATES';
    if (value.candidates !== undefined && !Array.isArray(value.candidates)) throw invalid();
    const candidates = value.candidates as unknown[] | undefined;
    if (!candidates?.length) {
      if (
        !['usageMetadata', 'promptFeedback', 'responseId', 'modelVersion', 'modelStatus'].some(
          (key) => value[key] !== undefined,
        )
      )
        throw invalid();
      return;
    }
    if (candidates.length !== 1) throw new AiError('Gemini 仅支持单个 index 0 候选，未保存版本。');
    const candidate = object(candidates[0]);
    // A single candidate may omit its zero-valued index; explicit invalid values remain errors.
    if (candidate.index !== undefined && candidate.index !== 0)
      throw new AiError(
        'Gemini 候选 index 必须为 0 且保持一致，未保存版本。',
        protocolStreamDiagnostic(
          'Gemini',
          'CANDIDATE_INDEX',
          'Gemini 返回了非零或非法候选编号，未保存版本。',
        ),
      );
    if (this.#stopped) throw new AiError('Gemini STOP 后仍收到候选，未保存不一致结果。');
    checkSafety(candidate);
    const finish = candidate.finishReason;
    if (finish === 'MAX_TOKENS') {
      const diagnostic = completionDiagnostic('Gemini（未正常 STOP）', 'limit');
      throw new AiError(diagnostic.message, diagnostic);
    }
    if (finish !== undefined && finish !== 'STOP')
      throw new AiError(
        'Gemini 响应未正常 STOP 完成，可能达到输出限制、被拒绝或安全阻断；未保存版本。',
      );
    this.stage = 'CONTENT';
    const chunks: string[] = [];
    if (candidate.content !== undefined) {
      const content = object(candidate.content);
      checkSafety(content);
      if (content.role !== undefined && content.role !== 'model')
        throw new AiError('Gemini 输出角色无效。');
      if (!Array.isArray(content.parts)) throw invalid();
      for (const rawPart of content.parts) {
        const part = object(rawPart);
        if (Object.keys(part).some((key) => !['text', 'thought', 'thoughtSignature'].includes(key)))
          throw new AiError('Gemini 本阶段不支持工具、拒绝或其他非正文输出，未保存版本。');
        if (part.thought !== undefined && typeof part.thought !== 'boolean') throw invalid();
        if (
          part.thoughtSignature !== undefined &&
          (typeof part.thoughtSignature !== 'string' || !part.thoughtSignature)
        )
          throw invalid();
        if (part.text !== undefined && typeof part.text !== 'string') throw invalid();
        if (part.text === undefined && part.thoughtSignature === undefined) throw invalid();
        if (part.thought !== undefined || part.thoughtSignature !== undefined)
          this.#markedParts.push(part);
        // A signature can accompany normal final text; only thought:true hides that text.
        if (part.thought !== true && typeof part.text === 'string') chunks.push(part.text);
      }
    } else if (finish !== 'STOP') throw invalid();
    const added = chunks.join('');
    if (this.#text.length + added.length > 700_000) throw new AiError('输出过长，已停止请求。');
    this.#text += added;
    if (finish === 'STOP') this.#stopped = true;
    // Validate the entire candidate before publishing any part of this frame.
    for (const chunk of chunks) if (chunk) this.onText(chunk);
  }

  finish(): string {
    if (!this.#stopped || !this.#text.trim())
      throw new AiError(
        'Gemini 流提前结束、缺少正常 STOP 或正文为空，原有内容保持不变。',
        protocolStreamDiagnostic(
          'Gemini',
          'END',
          'Gemini 流提前结束、缺少正常 STOP 或正文为空，原有内容保持不变。',
        ),
      );
    return this.#text;
  }
}

export async function streamGemini(options: Parameters<typeof streamChat>[0]): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = AbortSignal.any([options.signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    const body = geminiBody(options);
    const response = await fetch(options.endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpAiError(response.status);
    }
    if (
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
        'text/event-stream' ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new AiError('服务未返回 SSE 流，请检查 Gemini streamGenerateContent 兼容性。');
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stream = new GeminiStream((text) => {
      signal.throwIfAborted();
      options.onText(text);
    });
    let bytes = 0,
      pending = '',
      skipLF = false;
    let lines: string[] = [];
    // Line-based SSE framing supports LF, CRLF (even split across reads), and bare CR.
    const feed = (text: string) => {
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (skipLF) {
          skipLF = false;
          if (char === '\n') {
            start = i + 1;
            continue;
          }
        }
        if (char !== '\n' && char !== '\r') continue;
        const line = pending + text.slice(start, i);
        pending = '';
        start = i + 1;
        skipLF = char === '\r';
        if (line === '') {
          stream.frame(lines.join('\n'));
          lines = [];
        } else lines.push(line);
        signal.throwIfAborted();
      }
      pending += text.slice(start);
    };
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4_000_000) throw new AiError('响应超过大小限制，已停止请求。');
      feed(decoder.decode(chunk.value, { stream: true }));
    }
    feed(decoder.decode());
    signal.throwIfAborted();
    if (pending || lines.length) throw new AiError('Gemini SSE 帧在 EOF 时不完整，未保存结果。');
    return stream.finish();
  } catch (error) {
    if (options.signal.aborted) throw new AiError('已取消，本次不创建版本，旧内容保持不变。');
    if (timeout.aborted) throw new AiError('请求超过等待时间，未保存不完整结果。');
    if (error instanceof AiError) throw error;
    throw new AiError(
      'Gemini 网络连接失败或响应编码无效，请检查服务地址与网络。原有内容保持不变。',
    );
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
