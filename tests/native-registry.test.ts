import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { protocolEndpoint } from '../shared/ai.js';
import { emptyCapabilities, emptyParameters, wireParameters } from '../shared/models.js';
import { ConnectionRegistry } from '../electron/connection-registry.js';

test('native endpoint paths preserve prefixes, encode model position and use only generated SSE query', () => {
  assert.equal(
    protocolEndpoint('https://example.com', 'gemini', 'gemini-test'),
    'https://example.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse',
  );
  assert.equal(
    protocolEndpoint('https://example.com/proxy/v1beta', 'gemini', 'models/gemini-test'),
    'https://example.com/proxy/v1beta/models/gemini-test:streamGenerateContent?alt=sse',
  );
  assert.equal(
    protocolEndpoint(
      'https://example.com/proxy/v1beta/models/old:streamGenerateContent',
      'gemini',
      'new',
    ),
    'https://example.com/proxy/v1beta/models/new:streamGenerateContent?alt=sse',
  );
  assert.equal(
    protocolEndpoint('https://example.com', 'anthropic'),
    'https://example.com/v1/messages',
  );
  assert.equal(
    protocolEndpoint('https://example.com/proxy/v1/responses', 'anthropic'),
    'https://example.com/proxy/v1/messages',
  );
  assert.equal(
    protocolEndpoint('https://example.com/messages', 'anthropic'),
    'https://example.com/messages',
  );
  assert.equal(
    protocolEndpoint('https://example.com/v1/messages', 'responses'),
    'https://example.com/v1/responses',
  );
  for (const id of [
    '../model',
    'models/../../x',
    'model?key=x',
    'a/b',
    '%2F',
    'https://evil.invalid',
    'x#secret',
    'x\\y',
  ])
    assert.throws(() => protocolEndpoint('https://example.com', 'gemini', id));
  for (const protocol of ['gemini', 'anthropic'] as const)
    for (const base of [
      'http://remote.invalid',
      'https://user:password@example.com',
      'https://example.com?key=secret',
      'https://example.com?alt=sse',
      'https://example.com#fragment',
      'file:///tmp/a',
    ])
      assert.throws(() => protocolEndpoint(base, protocol, 'model'));
});

test('native parameters have honest defaults and reject cross-protocol reasoning/temperature values', () => {
  assert.deepEqual(wireParameters({}, 'anthropic'), { max_tokens: 4096 });
  assert.deepEqual(wireParameters({ temperature: 0.3, maxCompletionTokens: 8192 }, 'anthropic'), {
    temperature: 0.3,
    max_tokens: 8192,
  });
  assert.deepEqual(wireParameters({ temperature: 1.8, maxCompletionTokens: 2048 }, 'gemini'), {
    temperature: 1.8,
    maxOutputTokens: 2048,
  });
  assert.throws(() => wireParameters({ temperature: 1.1 }, 'anthropic'), /0–1/);
  for (const protocol of ['gemini', 'anthropic'] as const)
    assert.throws(() => wireParameters({ reasoningEffort: 'high' }, protocol), /推理/);
});

test('changing protocol refuses incompatible inherited defaults or page overrides atomically', () => {
  const db = new DatabaseSync(':memory:');
  const r = new ConnectionRegistry(db, {
    encrypt: (s) => Buffer.from('enc:' + s),
    decrypt: (s) => s.toString().slice(4),
  });
  try {
    const provider = r.saveProvider({
      name: 'Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'FAKE',
      protocol: 'chat-completions',
    });
    let model = r.saveModel({
      name: 'Model',
      modelId: 'model',
      providerId: provider.id,
      protocol: 'inherit',
      capabilities: emptyCapabilities(),
      parameterSupport: { ...emptyParameters(), temperature: true },
      parameters: { temperature: 0.5 },
    });
    r.select('resume', model.id, { temperature: 1.5 }, r.catalog().pages.resume.revision);
    const before = r.catalog();
    assert.throws(
      () => r.saveProvider({ ...provider, protocol: 'anthropic', apiKey: 'NEW-FAKE' }),
      /0–1/,
    );
    assert.deepEqual(r.catalog(), before);
    model = r.saveModel({ ...model, protocol: 'anthropic' });
    assert.equal(model.protocol, 'inherit');
    assert.equal(r.connection('resume')!.protocol, 'chat-completions');
    r.select('resume', model.id, {}, r.catalog().pages.resume.revision);
    const updated = r.saveProvider({ ...provider, protocol: 'anthropic', apiKey: 'NEW-FAKE' });
    assert.equal(r.connection('resume')!.parameters!.maxCompletionTokens, 4096);
    assert.equal(r.connection('resume')!.endpoint, 'https://example.com/v1/messages');
    const stable = r.catalog();
    // A model-level legacy value must not bypass the provider's native parameter validation.
    for (const legacy of ['chat-completions', 'gemini'] as const) {
      assert.throws(
        () =>
          r.saveModel({
            ...model,
            protocol: legacy,
            parameterSupport: { ...model.parameterSupport, reasoningEffort: true },
            parameters: { reasoningEffort: 'low' },
          }),
        /推理/,
      );
      assert.deepEqual(r.catalog(), stable);
    }
    assert.equal(r.catalog().providers[0].id, updated.id);
    assert.equal(r.credentials('resume').apiKey, 'NEW-FAKE');
    assert.ok(!JSON.stringify(r.catalog()).includes('NEW-FAKE'));
  } finally {
    db.close();
  }
});
