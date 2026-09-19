import { AiError, httpAiError, type Protocol } from '../shared/ai';
import type { DiscoveredModel } from '../shared/discovery';
function invalid(): never {
  throw new AiError('模型列表格式无效或超出安全上限；可手动添加模型。');
}
function token(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 2048 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    invalid();
  return value;
}
export function parseModelPage(body: unknown, protocol: Protocol) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
  const root = body as Record<string, unknown>;
  const entries = root[protocol === 'gemini' ? 'models' : 'data'];
  if (!Array.isArray(entries) || entries.length > 5000) invalid();
  const models = new Map<string, DiscoveredModel>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const raw = entry[protocol === 'gemini' ? 'name' : 'id'];
    if (typeof raw !== 'string') invalid();
    const id = protocol === 'gemini' ? raw.replace(/^models\//, '') : raw;
    if (!id || id.length > 256 || id !== id.trim() || /[\s\x00-\x1f\x7f?#\\]/.test(id)) invalid();
    // Remote names/descriptions/capabilities are not trusted configuration or diagnostics.
    models.set(id, { id, name: id });
  }
  let next: string | undefined;
  if (protocol === 'anthropic') {
    if (typeof root.has_more !== 'boolean') invalid();
    if (root.has_more) next = token(root.last_id);
  } else if (protocol === 'gemini') {
    if (root.nextPageToken !== undefined && root.nextPageToken !== '')
      next = token(root.nextPageToken);
  } else if (root.has_more === true || root.next || root.next_page) {
    throw new AiError('此兼容接口使用未支持的分页格式；未自动跟随下一页地址，请手动添加模型。');
  }
  return { models: [...models.values()], next };
}
export async function fetchModelPage(
  endpoint: string,
  protocol: Protocol,
  apiKey: string,
  signal: AbortSignal,
  cursor?: string,
  timeoutMs = 30000,
) {
  const url = new URL(endpoint);
  if (protocol === 'anthropic') {
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('after_id', token(cursor));
  }
  if (protocol === 'gemini') {
    url.searchParams.set('pageSize', '100');
    if (cursor) url.searchParams.set('pageToken', token(cursor));
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    combined.throwIfAborted();
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: combined,
      headers: {
        Accept: 'application/json',
        ...(protocol === 'gemini'
          ? { 'x-goog-api-key': apiKey }
          : protocol === 'anthropic'
            ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
            : { Authorization: `Bearer ${apiKey}` }),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpAiError(response.status);
    }
    if (
      !response.body ||
      response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
        'application/json'
    ) {
      await response.body?.cancel();
      throw new AiError('模型列表接口未返回 JSON；供应商可能未开放此接口，可手动添加模型。');
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1_000_000) invalid();
      chunks.push(value);
    }
    combined.throwIfAborted();
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      invalid();
    }
    return parseModelPage(body, protocol);
  } catch (error) {
    if (signal.aborted) throw new AiError('已取消获取模型列表。');
    if (timeout.aborted) throw new AiError('获取模型列表超时，请检查网络或代理；不会自动重试。');
    if (error instanceof AiError) throw error;
    throw new AiError('获取模型列表网络连接失败，请检查地址、网络和代理。');
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
