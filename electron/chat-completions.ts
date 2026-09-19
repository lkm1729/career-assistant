import { completionDiagnostic } from '../shared/diagnostics';
import { httpAiError } from '../shared/ai.js';
import { wireParameters, type Parameters } from '../shared/models.js';
import { AiError, type ResumeResult } from '../shared/ai.js';
export const formatInstruction = `输出必须是单个 JSON 对象，不添加前后文字。字段 document 为 Markdown 简历正文；suggestions 为 Markdown 排版美化建议；rationale 为简明设计说明，三个字段都必须为非空字符串。suggestions必须使用Markdown：用###小标题分组，每组用-列点，每条以**关键词**开头，说明具体行动及目的；不要输出表格、HTML或远程图片。rationale也用简短小标题和列点，不把建议混入document正文。正文中只写用户材料支持的事实。缺失信息使用明确的待补充占位，不虚构成果。`;
export function parseResume(text: string): ResumeResult {
  try {
    const value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
    for (const field of ['document', 'suggestions', 'rationale']) {
      if (
        typeof value[field] !== 'string' ||
        !value[field].trim() ||
        value[field].length > (field === 'document' ? 500_000 : 100_000)
      )
        throw new Error();
    }
    return { document: value.document, suggestions: value.suggestions, rationale: value.rationale };
  } catch {
    throw new AiError(
      '模型未返回完整的正文、排版建议和设计说明。结果未保存为正式版本，请重试或换用模型。',
    );
  }
}
export type ChatContent =
  string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export async function streamChat(options: {
  endpoint: string;
  apiKey: string;
  modelId: string;
  messages: { role: string; content: ChatContent }[];
  parameters?: Parameters;
  signal: AbortSignal;
  onText: (text: string) => void;
  timeoutMs?: number;
  /** Native Anthropic only: inactivity bound in addition to total timeoutMs. */
  idleTimeoutMs?: number;
  // Internal per-request Gemini option, never copied from renderer-supplied parameters.
  geminiResponseJsonSchema?: Record<string, unknown>;
  // Main-process-generated matching schema; never forwarded from renderer parameters.
  anthropicResponseJsonSchema?: Record<string, unknown>;
  // Main-process-generated Chat Completions response_format; never renderer-controlled.
  chatResponseJsonSchema?: Record<string, unknown>;
}): Promise<string> {
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
      body: JSON.stringify({
        model: options.modelId,
        messages: options.messages,
        stream: true,
        ...wireParameters(options.parameters ?? {}),
        ...(options.chatResponseJsonSchema
          ? { response_format: options.chatResponseJsonSchema }
          : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpAiError(response.status);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new AiError('服务未返回 SSE 流，请检查 Chat Completions 兼容性。');
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '',
      finish: string | null = null,
      done = false,
      bytes = 0;
    const processFrame = (frame: string) => {
      const data = frame
        .split(/\r\n|\r|\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        done = true;
        return;
      }
      let value;
      try {
        value = JSON.parse(data);
      } catch {
        throw new AiError('响应流格式损坏，未保存不完整结果。');
      }
      if (value.error) throw new AiError('服务在生成过程中返回错误，未保存不完整结果。');
      const choice = value.choices?.find(
        (item: { index?: number }) => item.index === 0 || item.index === undefined,
      );
      if (!choice) {
        if (Array.isArray(value.choices) && value.choices.length)
          throw new AiError('响应候选index无效，未保存不完整结果。');
        return;
      }
      if (choice.delta?.refusal) throw new AiError('模型拒绝了本次请求，未生成正式版本。');
      const chunk = choice.delta?.content;
      if (chunk !== undefined && chunk !== null) {
        if (typeof chunk !== 'string' || finish) throw new AiError('响应流内容格式无效。');
        text += chunk;
        if (text.length > 700_000) throw new AiError('输出过长，已停止请求。');
        options.onText(chunk);
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== 'string' || finish)
          throw new AiError('响应完成状态重复或无效，未保存不完整结果。');
        finish = choice.finish_reason;
        if (finish !== 'stop') {
          const diagnostic = completionDiagnostic(
            'Chat Completions',
            finish === 'length' ? 'limit' : 'blocked',
          );
          throw new AiError(diagnostic.message, diagnostic);
        }
      }
    };
    let line = '',
      lines: string[] = [],
      skipLF = false;
    const feed = (value: string) => {
      for (const char of value) {
        if (done) break;
        if (skipLF) {
          skipLF = false;
          if (char === '\n') continue;
        }
        if (char === '\r' || char === '\n') {
          skipLF = char === '\r';
          if (line === '') {
            processFrame(lines.join('\n'));
            lines = [];
          } else lines.push(line);
          line = '';
        } else line += char;
      }
    };
    while (!done) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 4_000_000) throw new AiError('响应超过大小限制，已停止请求。');
      feed(decoder.decode(chunk.value, { stream: true }));
    }
    feed(decoder.decode());
    signal.throwIfAborted();
    // A fully framed explicit natural stop plus clean EOF is accepted for compatible
    // providers omitting [DONE]. Never synthesize stop from parseable JSON or EOF.
    if (!done && (line || lines.length)) {
      // Known sentinel may omit the final empty line, but JSON events may not.
      if ([...lines, line].filter(Boolean).join('\n').trim() !== 'data: [DONE]') {
        const diagnostic = completionDiagnostic('Chat Completions', 'incomplete');
        throw new AiError(diagnostic.message, diagnostic);
      }
    }
    if (finish !== 'stop' || !text.trim()) {
      const diagnostic = completionDiagnostic(
        'Chat Completions',
        finish !== 'stop' ? 'incomplete' : 'empty',
      );
      throw new AiError(diagnostic.message, diagnostic);
    }
    return text;
  } catch (error) {
    if (options.signal.aborted) throw new AiError('已取消，本次不创建版本，旧内容保持不变。');
    if (timeout.aborted) throw new AiError('请求超过等待时间，未保存不完整结果。');
    if (error instanceof AiError) throw error;
    throw new AiError('网络连接失败，请检查服务地址、网络或代理设置。原有内容保持不变。');
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
