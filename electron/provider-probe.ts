import { AiError, httpAiError, type Protocol } from '../shared/ai.js';
export async function probeProvider(
  endpoint: string,
  protocol: Protocol,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(endpoint, {
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
    if (!response.body || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw new AiError('供应商模型列表未返回 JSON，可能指向网页或不支持该探针。');
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 1_000_000)
        throw new AiError('供应商模型列表过大，已停止读取；可单独运行模型探针。');
      chunks.push(value);
    }
    combined.throwIfAborted();
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AiError('供应商模型列表 JSON 格式无效。');
    }
    const values =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)[protocol === 'gemini' ? 'models' : 'data']
        : undefined;
    if (!Array.isArray(values))
      throw new AiError('响应不是预期的模型列表格式；代理可能未实现列表接口，请单独测试模型。');
    return `供应商列表探针通过：HTTP ${response.status}，本页列表包含 ${values.length} 个条目。仅验证列表接口请求，不代表模型生成、计费权限或图片能力；请继续运行模型文本探针。`;
  } catch (error) {
    if (signal.aborted) throw new AiError('已取消供应商探针。');
    if (timeout.aborted) throw new AiError('供应商探针超时，请检查网络或代理。');
    if (error instanceof AiError) throw error;
    throw new AiError('供应商探针网络连接失败，请检查地址、网络和代理。');
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
