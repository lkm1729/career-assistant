import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageDiagnostic } from '../shared/diagnostics.js';
import { AiError, httpAiError } from '../shared/ai.js';
import { publicAiDiagnostic } from '../electron/ai-service.js';
import { parseResume } from '../electron/chat-completions.js';

for (const [message, code] of [
  ['有请求正在运行，请等待完成或先取消生成。', 'AI_BUSY'],
  ['取消请求未确认，请等待当前请求结束。', 'AI_CANCEL_UNCONFIRMED'],
  ['请先取消生成。', 'AI_CONFIGURATION'],
  ['尚未取消请求。', 'AI_CONFIGURATION'],
  ['已取消选择模型。', 'AI_CONFIGURATION'],
]) {
  test(`does not claim cancellation is complete: ${message}`, () => {
    const diagnostic = messageDiagnostic(message);
    assert.equal(diagnostic.code, code);
    assert.doesNotMatch(diagnostic.possibleCauses.join(' '), /已.*取消/);
    assert.doesNotMatch(diagnostic.solutions.join(' '), /重新确认发送|不会保存/);
  });
}

for (const message of ['已取消供应商探针。', '已取消，本次不创建版本，旧内容保持不变。']) {
  test(`reports confirmed cancellation: ${message}`, () => {
    assert.equal(messageDiagnostic(message).code, 'AI_CANCELLED');
  });
}

for (const message of [
  'Base URL 格式无效。',
  '密钥格式无效。',
  '请输入完整的 Base URL。',
  'JSON 参数格式无效。',
  '模型 ID 字段无效。',
]) {
  test(`classifies local validation as configuration: ${message}`, () => {
    const diagnostic = messageDiagnostic(message);
    assert.equal(diagnostic.code, 'AI_CONFIGURATION');
    assert.doesNotMatch(diagnostic.possibleCauses.join(' '), /响应中断|模型没有遵守/);
    assert.doesNotMatch(diagnostic.solutions.join(' '), /模型文本探针|输出上限/);
  });
}

for (const message of [
  'Responses 流提前结束，未收到 response.completed，原有内容保持不变。',
  'Responses 未收到完整完成事件，原有内容保持不变。',
]) {
  test(`classifies terminal stream truncation as incomplete: ${message}`, () => {
    assert.equal(messageDiagnostic(message).code, 'AI_STREAM_INCOMPLETE');
  });
}

for (const message of [
  '供应商模型列表未返回 JSON，可能指向网页或不支持该探针。',
  '供应商模型列表 JSON 格式无效。',
  '响应不是预期的模型列表格式；代理可能未实现列表接口，请单独测试模型。',
  '服务未返回 SSE 流，请检查 Chat Completions 兼容性。',
  '响应流格式损坏，未保存不完整结果。',
  'Anthropic 响应流 JSON 损坏，未保存不完整结果。',
  'Gemini SSE 帧在 EOF 时不完整，未保存结果。',
  'Gemini 响应标识或模型版本不一致，未保存版本。',
  'Responses 流事件类型不一致。',
  'Responses 正文增量与最终内容不一致，未保存版本。',
  'Responses 没有完整的正文输出，未保存版本。',
  '模型未返回完整的正文、排版建议和设计说明。结果未保存为正式版本，请重试或换用模型。',
]) {
  test(`retains response format diagnostics: ${message}`, () => {
    assert.equal(messageDiagnostic(message).code, 'AI_RESPONSE_FORMAT');
  });
}

for (const [message, code] of [
  ['供应商探针网络连接失败，请检查地址、网络和代理。', 'AI_NETWORK'],
  ['供应商探针超时，请检查网络或代理。', 'AI_TIMEOUT'],
  ['请求超过等待时间，未保存不完整结果。', 'AI_TIMEOUT'],
  ['草稿在确认后已改变，未覆盖任何内容。请重新确认。', 'AI_STALE_STATE'],
  ['确认内容与已保存草稿不一致，请先保存后重新确认。', 'AI_STALE_STATE'],
  ['供应商探针通信失败，请重新打开设置查看记录。', 'AI_LOCAL_OPERATION'],
]) {
  test(`preserves other application diagnostics: ${code}`, () => {
    assert.equal(publicAiDiagnostic(new AiError(message)).code, code);
  });
}

test('untrusted exception text is discarded before message classification', () => {
  const external = 'FAKE-PRIVATE-TOKEN 已取消供应商探针。 JSON SSE';
  const diagnostic = publicAiDiagnostic(new Error(external));
  assert.equal(diagnostic.code, 'AI_LOCAL_OPERATION');
  assert.ok(!JSON.stringify(diagnostic).includes('FAKE-PRIVATE-TOKEN'));
  assert.notEqual(diagnostic.message, external);
});

test('invalid remote JSON retains a safe response-format diagnostic without echoing its body', () => {
  assert.throws(
    () => parseResume('FAKE-PRIVATE-RESPONSE-BODY'),
    (error: unknown) => {
      const diagnostic = publicAiDiagnostic(error);
      assert.equal(diagnostic.code, 'AI_RESPONSE_FORMAT');
      assert.ok(!JSON.stringify(diagnostic).includes('FAKE-PRIVATE-RESPONSE-BODY'));
      return true;
    },
  );
});

for (const status of [401, 403, 429, 500]) {
  test(`preserves explicit HTTP diagnostics: ${status}`, () => {
    const diagnostic = publicAiDiagnostic(httpAiError(status));
    assert.equal(diagnostic.code, `AI_HTTP_${status}`);
    assert.equal(diagnostic.httpStatus, status);
  });
}
