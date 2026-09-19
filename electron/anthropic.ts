import { Agent, fetch as nativeFetch } from 'undici';
import { completionDiagnostic } from '../shared/diagnostics';
import { protocolStreamDiagnostic } from '../shared/diagnostics.js';
import { httpAiError } from '../shared/ai.js';
import { AiError } from '../shared/ai.js';
import type { streamChat } from './chat-completions.js';

type Options = Parameters<typeof streamChat>[0];
type Value = Record<string, unknown>;
const MAX_REQUEST_BYTES = 32_000_000;
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_STREAM_BYTES = 4_000_000;
const MAX_FRAME_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 700_000;
const invalid = () => new AiError('Anthropic 响应流结构或生命周期无效，未保存不完整结果。');
function object(value: unknown): Value {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Value;
}
type Text = { type: 'text'; text: string };
type Image = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };
};

/** Only effective (enabled) options reach this boundary; never forward arbitrary fields. */
export function anthropicBody(
  options: Pick<Options, 'modelId' | 'messages' | 'parameters' | 'anthropicResponseJsonSchema'>,
) {
  const params = options.parameters === undefined ? {} : object(options.parameters);
  if (params.reasoningEffort !== undefined)
    throw new AiError('本批 Anthropic Messages 不支持 reasoningEffort，请关闭推理强度参数。');
  if (
    Object.keys(params).some(
      (key) =>
        !['temperature', 'maxCompletionTokens'].includes(key) &&
        !(key === 'reasoningEffort' && params[key] === undefined),
    )
  )
    throw new AiError('Anthropic 包含不支持的高级参数。');
  const maxTokens = params.maxCompletionTokens ?? 4096;
  if (
    !Number.isSafeInteger(maxTokens) ||
    (maxTokens as number) < 1 ||
    (maxTokens as number) > 1_000_000 ||
    params.maxCompletionTokens === null
  )
    throw new AiError('Anthropic 输出上限应为 1–1000000 的整数，实际限制由模型决定。');
  if (
    params.temperature !== undefined &&
    (typeof params.temperature !== 'number' ||
      !Number.isFinite(params.temperature) ||
      params.temperature < 0 ||
      params.temperature > 1)
  )
    throw new AiError('Anthropic 温度应在 0–1 之间。');
  if (
    typeof options.modelId !== 'string' ||
    !options.modelId.trim() ||
    options.modelId.length > 256 ||
    /[\x00-\x1f\x7f]/.test(options.modelId)
  )
    throw new AiError('Anthropic 模型 ID 无效。');
  if (
    !Array.isArray(options.messages) ||
    options.messages.length === 0 ||
    options.messages.length > 1000
  )
    throw new AiError('Anthropic 消息数量无效。');
  let inputBytes = 0;
  const count = (value: string) => {
    inputBytes += Buffer.byteLength(value, 'utf8');
    if (inputBytes > MAX_REQUEST_BYTES) throw new AiError('Anthropic 请求超过大小限制。');
  };
  const system: Text[] = [];
  const messages: { role: 'user' | 'assistant'; content: (Text | Image)[] }[] = [];
  for (const raw of options.messages) {
    const message = object(raw);
    const role = message.role;
    if (typeof role !== 'string' || !['system', 'user', 'assistant'].includes(role))
      throw new AiError('Anthropic 仅支持 system、user 和 assistant 消息角色。');
    // Moving a mid-conversation instruction to the top would change its meaning.
    if (role === 'system' && messages.length)
      throw new AiError('Anthropic system 消息必须位于对话开头。');
    const parts =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content;
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 1024)
      throw new AiError('Anthropic 消息内容无效或超过数量限制。');
    const content: (Text | Image)[] = [];
    for (const rawPart of parts) {
      const part = object(rawPart);
      if (part.type === 'text' && typeof part.text === 'string') {
        count(part.text);
        content.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url' && role === 'user') {
        const url = object(part.image_url).url;
        if (typeof url !== 'string' || url.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32)
          throw new AiError('Anthropic 图片无效或超过 5 MB 限制。');
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
        if (!match || match[0] !== url || match[2].length % 4 !== 0)
          throw new AiError(
            'Anthropic 仅接受内嵌 PNG、JPEG、WebP 的规范 base64 图片，不支持远程图片。',
          );
        const bytes = Buffer.from(match[2], 'base64');
        if (
          !bytes.length ||
          bytes.length > MAX_IMAGE_BYTES ||
          bytes.toString('base64') !== match[2]
        )
          throw new AiError('Anthropic 图片 base64 无效或超过 5 MB 限制。');
        count(url);
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1] as Image['source']['media_type'],
            data: match[2],
          },
        });
      } else {
        throw new AiError('Anthropic 不支持此内容类型；图片只能出现在 user 消息中。');
      }
    }
    if (role === 'system') system.push(...(content as Text[]));
    else messages.push({ role: role as 'user' | 'assistant', content });
  }
  if (!messages.length) throw new AiError('Anthropic 至少需要一条 user 或 assistant 消息。');
  const body = {
    model: options.modelId,
    ...(system.length ? { system } : {}),
    messages,
    stream: true as const,
    max_tokens: maxTokens as number,
    ...(options.anthropicResponseJsonSchema
      ? {
          output_config: {
            format: { type: 'json_schema' as const, schema: options.anthropicResponseJsonSchema },
          },
        }
      : {}),
    ...(params.temperature === undefined ? {} : { temperature: params.temperature as number }),
  };
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES)
    throw new AiError('Anthropic 请求超过大小限制。');
  return body;
}

type DeltaFailure =
  | 'PHASE'
  | 'NO_ACTIVE_BLOCK'
  | 'INDEX_TYPE'
  | 'INDEX_MISMATCH'
  | 'DELTA_OBJECT'
  | 'UNKNOWN_DELTA_TYPE'
  | 'BLOCK_TYPE_MISMATCH'
  | 'TEXT_TYPE'
  | 'THINKING_TYPE'
  | 'THINKING_AFTER_SIGNATURE'
  | 'SIGNATURE_TYPE'
  | 'CITATION_SHAPE';
const knownDeltas = [
  'text_delta',
  'thinking_delta',
  'signature_delta',
  'citations_delta',
  'input_json_delta',
] as const;
const shape = (value: unknown) =>
  value === undefined
    ? 'missing'
    : value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'string'
          ? value
            ? 'string'
            : 'empty-string'
          : typeof value === 'object'
            ? 'object'
            : typeof value === 'number'
              ? 'number'
              : typeof value === 'boolean'
                ? 'boolean'
                : 'other';
function citationMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as Value;
  if (typeof c.cited_text !== 'string') return false;
  const nullable = (v: unknown) => v == null || typeof v === 'string';
  const index = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const range = (start: unknown, end: unknown, min = 0) =>
    index(start) && index(end) && (start as number) >= min && (end as number) > (start as number);
  switch (c.type) {
    case 'char_location':
    case 'page_location':
    case 'content_block_location': {
      if (!index(c.document_index) || !nullable(c.document_title) || !nullable(c.file_id))
        return false;
      return c.type === 'char_location'
        ? range(c.start_char_index, c.end_char_index)
        : c.type === 'page_location'
          ? range(c.start_page_number, c.end_page_number, 1)
          : range(c.start_block_index, c.end_block_index);
    }
    case 'search_result_location':
      return (
        index(c.search_result_index) &&
        range(c.start_block_index, c.end_block_index) &&
        typeof c.source === 'string' &&
        nullable(c.title)
      );
    case 'web_search_result_location':
      return (
        typeof c.encrypted_index === 'string' && typeof c.url === 'string' && nullable(c.title)
      );
    default:
      return false;
  }
}

/** A single, sequential Messages lifecycle. Only text-block content can reach onText. */
export class AnthropicStream {
  private phase: 'initial' | 'blocks' | 'stopping' | 'done' = 'initial';
  private nextIndex = 0;
  private active: {
    index: number;
    type: 'text' | 'thinking' | 'redacted_thinking';
    signed: boolean;
    signatureStarted: boolean;
  } | null = null;
  private text = '';
  result: string | null = null;
  constructor(private onText: (text: string) => void) {}

  private activity: 'WAITING_EVENTS' | 'THINKING' | 'TEXT' | 'FINISHING' = 'WAITING_EVENTS';
  get progress() {
    return this.activity;
  }
  private stage = 'FRAME';
  frame(frame: string) {
    this.stage = 'FRAME';
    try {
      this.readFrame(frame);
    } catch (error) {
      if (!(error instanceof AiError) || error.diagnostic) throw error;
      const diagnostic = protocolStreamDiagnostic('Anthropic', this.stage, error.message);
      throw new AiError(diagnostic.message, diagnostic);
    }
  }
  private appendText(text: string) {
    if (this.text.length + text.length > MAX_TEXT_CHARS)
      throw new AiError('输出过长，已停止请求。');
    this.text += text;
    if (!text) return;
    try {
      this.onText(text);
    } catch {
      throw new AiError('Anthropic 正文回调失败，未保存不完整结果。');
    }
  }
  private readFrame(frame: string) {
    if (frame.length > MAX_FRAME_CHARS) throw new AiError('Anthropic SSE 事件超过大小限制。');
    const lines = frame.split(/\r\n|\r|\n/);
    const dataLines: string[] = [];
    let named: string | undefined;
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') dataLines.push(value);
      if (field === 'event') {
        if (named !== undefined) throw invalid();
        named = value;
      }
    }
    if (!dataLines.length) {
      if (named !== undefined) throw invalid();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(dataLines.join('\n'));
    } catch {
      throw new AiError('Anthropic 响应流 JSON 损坏，未保存不完整结果。');
    }
    const event = object(raw);
    if (
      typeof event.type !== 'string' ||
      (named !== undefined && named !== event.type) ||
      this.phase === 'done'
    )
      throw invalid();
    if (event.type === 'error' || event.error !== undefined)
      throw new AiError('Anthropic 服务在生成过程中返回错误，未保存不完整结果。');
    if (event.type === 'ping') return;
    switch (event.type) {
      case 'message_start': {
        this.stage = 'MESSAGE_START';
        const message = object(event.message);
        if (
          this.phase !== 'initial' ||
          message.type !== 'message' ||
          message.role !== 'assistant' ||
          typeof message.id !== 'string' ||
          !message.id ||
          !Array.isArray(message.content) ||
          message.content.length ||
          (message.stop_reason !== null && message.stop_reason !== undefined) ||
          (message.stop_sequence !== null && message.stop_sequence !== undefined)
        )
          throw invalid();
        this.phase = 'blocks';
        break;
      }
      case 'content_block_start': {
        this.stage = 'CONTENT_BLOCK_START';
        if (
          this.phase !== 'blocks' ||
          this.active ||
          !Number.isSafeInteger(event.index) ||
          event.index !== this.nextIndex ||
          this.nextIndex >= 1024
        )
          throw invalid();
        const block = object(event.content_block);
        if (block.type === 'text') {
          if (typeof block.text !== 'string') throw invalid();
        } else if (block.type === 'thinking') {
          if (
            typeof block.thinking !== 'string' ||
            (block.signature !== undefined && typeof block.signature !== 'string')
          )
            throw invalid();
        } else if (block.type === 'redacted_thinking') {
          if (typeof block.data !== 'string' || !block.data) throw invalid();
        } else {
          throw new AiError('本批 Anthropic 不支持工具、拒绝或其他非正文内容块，未保存版本。');
        }
        this.activity = block.type === 'text' ? 'TEXT' : 'THINKING';
        this.active = {
          index: this.nextIndex,
          type: block.type,
          signatureStarted:
            block.type === 'thinking' &&
            typeof block.signature === 'string' &&
            block.signature.length > 0,
          signed:
            block.type === 'thinking' &&
            typeof block.signature === 'string' &&
            block.signature.length > 0,
        };
        // Start events may contain text; only the text block is published, never thinking/signatures.
        if (block.type === 'text') this.appendText(block.text as string);
        this.nextIndex++;
        break;
      }
      case 'content_block_delta': {
        this.stage = 'CONTENT_BLOCK_DELTA';
        if (this.phase !== 'blocks') this.deltaFailure('PHASE', event);
        if (!this.active) this.deltaFailure('NO_ACTIVE_BLOCK', event);
        if (!Number.isSafeInteger(event.index)) this.deltaFailure('INDEX_TYPE', event);
        if (event.index !== this.active!.index) this.deltaFailure('INDEX_MISMATCH', event);
        if (!event.delta || typeof event.delta !== 'object' || Array.isArray(event.delta))
          this.deltaFailure('DELTA_OBJECT', event);
        const delta = event.delta as Value;
        const block = this.active!;
        switch (delta.type) {
          case 'text_delta':
            if (block.type !== 'text') this.deltaFailure('BLOCK_TYPE_MISMATCH', event);
            if (typeof delta.text !== 'string') this.deltaFailure('TEXT_TYPE', event);
            this.appendText(delta.text as string);
            break;
          case 'thinking_delta':
            if (block.type !== 'thinking') this.deltaFailure('BLOCK_TYPE_MISMATCH', event);
            if (block.signatureStarted) this.deltaFailure('THINKING_AFTER_SIGNATURE', event);
            if (typeof delta.thinking !== 'string') this.deltaFailure('THINKING_TYPE', event);
            // Never accumulate or expose thinking content.
            break;
          case 'signature_delta':
            if (block.type !== 'thinking') this.deltaFailure('BLOCK_TYPE_MISMATCH', event);
            if (typeof delta.signature !== 'string') this.deltaFailure('SIGNATURE_TYPE', event);
            block.signatureStarted = true;
            // Signatures are discarded metadata, never verified, persisted or replayed.
            if ((delta.signature as string).length) block.signed = true;
            break;
          case 'citations_delta':
            if (block.type !== 'text') this.deltaFailure('BLOCK_TYPE_MISMATCH', event);
            if (!citationMetadata(delta.citation)) this.deltaFailure('CITATION_SHAPE', event);
            // Transport metadata only. Never append, fetch, persist or use it as validated scoring evidence.
            break;
          default:
            this.deltaFailure('UNKNOWN_DELTA_TYPE', event);
        }
        break;
      }
      case 'content_block_stop':
        this.stage = 'CONTENT_BLOCK_STOP';
        if (this.phase !== 'blocks') this.stopFailure('PHASE', event);
        if (!this.active) this.stopFailure('NO_ACTIVE_BLOCK', event);
        if (!Number.isSafeInteger(event.index)) this.stopFailure('INDEX_TYPE', event);
        if (event.index !== this.active!.index) this.stopFailure('INDEX_MISMATCH', event);
        // A proxy may emit an empty signature string. This text-only consumer never replays
        // thinking blocks; accept that explicit metadata event, not a missing lifecycle.
        if (this.active!.type === 'thinking' && !this.active!.signatureStarted)
          this.stopFailure('MISSING_SIGNATURE', event);
        this.active = null;
        break;
      case 'message_delta': {
        this.stage = 'MESSAGE_DELTA';
        if (!['blocks', 'stopping'].includes(this.phase) || this.active) throw invalid();
        const delta = object(event.delta);
        if (delta.stop_details !== undefined && delta.stop_details !== null) throw invalid();
        // A usage/metadata delta cannot complete a message. Omitted nullable fields are not terminators.
        if (delta.stop_reason === undefined || delta.stop_reason === null) {
          if (delta.stop_sequence !== undefined && delta.stop_sequence !== null) throw invalid();
          break;
        }
        if (this.phase !== 'blocks') throw invalid();
        if (delta.stop_reason === 'max_tokens') {
          const diagnostic = completionDiagnostic('Anthropic（未正常 end_turn）', 'limit');
          throw new AiError(diagnostic.message, diagnostic);
        }
        // No stop_sequences are sent: only a natural end_turn authorizes persistence.
        if (
          delta.stop_reason !== 'end_turn' ||
          (delta.stop_sequence !== null && delta.stop_sequence !== undefined)
        )
          throw new AiError(
            'Anthropic 未正常 end_turn（输出限制、工具、拒绝或暂停），未保存不完整结果。',
          );
        this.activity = 'FINISHING';
        this.phase = 'stopping';
        break;
      }
      case 'message_stop':
        this.stage = 'MESSAGE_STOP';
        if (this.phase !== 'stopping')
          throw new AiError('Anthropic 缺少正常 end_turn 终止事件，未保存不完整结果。');
        if (this.active || !this.text.trim()) throw invalid();
        this.phase = 'done';
        this.result = this.text;
        break;
      default:
        throw new AiError('Anthropic 返回不支持的 SSE 事件，未保存不完整结果。');
    }
  }
  private deltaFailure(reason: DeltaFailure, event: Value): never {
    const d =
      event.delta && typeof event.delta === 'object' && !Array.isArray(event.delta)
        ? (event.delta as Value)
        : {};
    // Every emitted value is a local enum: no raw types, indexes, text, keys, URLs or signatures.
    const delta = knownDeltas.find((type) => type === d.type) ?? 'other';
    const index = !Number.isSafeInteger(event.index)
      ? 'invalid'
      : !this.active
        ? 'no-active'
        : event.index === this.active.index
          ? 'same'
          : 'different';
    const facts =
      'reason=' +
      reason +
      '; phase=' +
      this.phase +
      '; block=' +
      (this.active?.type ?? 'none') +
      '; delta=' +
      delta +
      '; index=' +
      index +
      '; text=' +
      shape(d.text) +
      '; thinking=' +
      shape(d.thinking) +
      '; signature=' +
      shape(d.signature) +
      '; citation=' +
      shape(d.citation);
    const diagnostic = protocolStreamDiagnostic(
      'Anthropic',
      'CONTENT_BLOCK_DELTA',
      'Anthropic 响应流结构或生命周期无效，未保存不完整结果。',
    );
    diagnostic.message += ' 结构诊断：' + facts;
    diagnostic.solutions = [
      '请反馈报错码及上述结构诊断、模型ID与任务类型；只含本地枚举，不需要Key、简历、思考文本或原始响应。',
      '不能仅凭结构诊断判断供应商或代理责任；应用不会自动切换协议、续写或重试收费请求。',
      ...diagnostic.solutions,
    ];
    throw new AiError(diagnostic.message, diagnostic);
  }
  private stopFailure(
    reason: 'PHASE' | 'NO_ACTIVE_BLOCK' | 'INDEX_TYPE' | 'INDEX_MISMATCH' | 'MISSING_SIGNATURE',
    event: Value,
  ): never {
    // Describe only local state. Never include remote values, body, signature, ID or raw index.
    const index = !Number.isSafeInteger(event.index)
      ? 'invalid'
      : !this.active
        ? 'no-active'
        : event.index === this.active.index
          ? 'same'
          : 'different';
    const signature =
      this.active?.type !== 'thinking'
        ? 'not-applicable'
        : this.active.signed
          ? 'nonempty'
          : this.active.signatureStarted
            ? 'empty-only'
            : 'not-started';
    const diagnostic = protocolStreamDiagnostic(
      'Anthropic',
      'CONTENT_BLOCK_STOP',
      'Anthropic 响应流结构或生命周期无效，未保存不完整结果。',
    );
    diagnostic.message +=
      ' 结构诊断：reason=' +
      reason +
      '; phase=' +
      this.phase +
      '; block=' +
      (this.active?.type ?? 'none') +
      '; index=' +
      index +
      '; signature=' +
      signature;
    diagnostic.solutions = [
      '请反馈报错码及上述结构诊断、模型ID与任务类型；只含本地枚举，不需要Key、简历、思考文本或原始响应。',
      'MISSING_SIGNATURE表示思考块缺少签名阶段事件（或起始非空签名）；空字符串签名增量已兼容。客户端不验证或回传思考签名。',
      '应用不会自动切换协议、续写或重试收费请求；已有结果保持不变。',
    ];
    throw new AiError(diagnostic.message, diagnostic);
  }
}

/** Incremental SSE framing, including LF, CRLF and CR split across network chunks. */
class Frames {
  private pending = '';
  private skipLF = false;
  private lines: string[] = [];
  private size = 0;
  constructor(private stream: AnthropicStream) {}
  push(text: string) {
    if (text) {
      if (this.skipLF && text.startsWith('\n')) text = text.slice(1);
      this.skipLF = false;
    }
    this.pending += text;
    let offset = 0;
    const ends = /\r\n|\r|\n/g;
    let match: RegExpExecArray | null;
    while ((match = ends.exec(this.pending))) {
      if (match[0] === '\r' && match.index === this.pending.length - 1) this.skipLF = true;
      const line = this.pending.slice(offset, match.index);
      offset = match.index + match[0].length;
      if (!line) {
        this.stream.frame(this.lines.join('\n'));
        this.lines = [];
        this.size = 0;
      } else {
        this.size += line.length + 1;
        if (this.size > MAX_FRAME_CHARS) throw new AiError('Anthropic SSE 事件超过大小限制。');
        this.lines.push(line);
      }
    }
    this.pending = this.pending.slice(offset);
    if (this.size + this.pending.length > MAX_FRAME_CHARS)
      throw new AiError('Anthropic SSE 事件超过大小限制。');
    if (this.stream.result !== null && (this.lines.length || this.pending.trim())) throw invalid();
  }
}

export async function streamAnthropic(options: Parameters<typeof streamChat>[0]): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647)
    throw new AiError('Anthropic 请求等待时间无效。');
  const idleMs = options.idleTimeoutMs;
  if (
    idleMs !== undefined &&
    (!Number.isSafeInteger(idleMs) || idleMs < 0 || idleMs > 2_147_483_647)
  )
    throw new AiError('Anthropic 空闲等待时间无效。');
  const timeout = AbortSignal.timeout(timeoutMs);
  const idle = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (idleMs === undefined) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), idleMs);
    idleTimer.unref();
  };
  const signal = AbortSignal.any([options.signal, timeout, idle.signal]);
  let progress: string = 'CONNECTING';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let dispatcher: Agent | undefined;
  try {
    signal.throwIfAborted();
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw new AiError('Anthropic 服务地址无效。');
    }
    if (
      options.endpoint.length > 2048 ||
      !['https:', 'http:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
    )
      throw new AiError(
        'Anthropic 地址必须为 HTTPS（本机可用 HTTP），不允许凭证、查询参数或片段。',
      );
    if (
      typeof options.apiKey !== 'string' ||
      options.apiKey.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(options.apiKey)
    )
      throw new AiError('Anthropic 密钥格式无效。');
    const body = anthropicBody(options);
    // The finite application total/idle signals own all request deadlines. Node fetch's
    // independent header/body/connect defaults must not preempt a long reasoning request.
    // Per-request dispatcher: no global mutation, no retry interceptor, destroyed on every exit.
    dispatcher = new Agent({
      // Agent.destroy alone cannot reclaim a socket still in DNS/TCP/TLS setup.
      // Forward the same finite deadline/cancel signal into the socket connector.
      connect: { timeout: 0, signal },
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    touch();
    const response = await nativeFetch(options.endpoint, {
      dispatcher,
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
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
      throw new AiError('服务未返回 SSE 流，请检查 Anthropic Messages 兼容性。');
    }
    progress = 'WAITING_EVENTS';
    touch();
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stream = new AnthropicStream((text) => {
      signal.throwIfAborted();
      options.onText(text);
      signal.throwIfAborted();
    });
    const frames = new Frames(stream);
    let bytes = 0;
    while (stream.result === null) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) {
        frames.push(decoder.decode());

        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw new AiError('响应超过大小限制，已停止请求。');
      frames.push(decoder.decode(chunk.value, { stream: true }));
      progress = stream.progress;
      if (chunk.value.byteLength) touch();
    }
    signal.throwIfAborted();
    if (stream.result === null)
      throw new AiError(
        'Anthropic 流提前结束，未收到完整 message_stop，原有内容保持不变。',
        protocolStreamDiagnostic(
          'Anthropic',
          'END',
          'Anthropic 流提前结束，未收到完整 message_stop，原有内容保持不变。',
        ),
      );
    // Reject a dangling partial UTF-8 character even if message_stop preceded it.
    if (decoder.decode()) throw invalid();
    return stream.result;
  } catch (error) {
    if (options.signal.aborted) throw new AiError('已取消，本次不创建版本，旧内容保持不变。');
    if (timeout.aborted || idle.signal.aborted) {
      const reason = idle.signal.aborted ? 'IDLE_LIMIT' : 'TOTAL_LIMIT';
      const message =
        '请求超过等待时间，未保存不完整结果。结构诊断：reason=' + reason + '; phase=' + progress;
      throw new AiError(message, {
        code: 'AI_TIMEOUT',
        message,
        possibleCauses: [
          reason === 'IDLE_LIMIT'
            ? '超过连续无数据等待时限，可能仍在排队、思考或连接已停滞；不能据此确定供应商状态'
            : '已达到本次请求的总等待上限，即使仍有流数据也必须停止',
        ],
        solutions: [
          '可取消等待或减少资料规模；应用不会自动重试，已有记录保持不变',
          '超时不代表供应商未计费或已停止，重新发送前请确认请求状态',
          '反馈错误码及固定结构诊断即可，无需Key、正文或原始响应',
        ],
      });
    }
    if (error instanceof AiError) throw error;
    throw new AiError(
      'Anthropic 网络连接失败或响应编码无效，请检查服务地址与网络。原有内容保持不变。',
    );
  } finally {
    clearTimeout(idleTimer);
    await reader?.cancel().catch(() => {});
    await dispatcher?.destroy().catch(() => {});
  }
}
