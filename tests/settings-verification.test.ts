import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ConnectionRegistry } from '../electron/connection-registry.js';
import { emptyCapabilities, emptyParameters, modelConnection } from '../shared/models.js';

test('editing a provider address retains the exact encrypted key without decrypting it', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const registry = new ConnectionRegistry(db, {
      encrypt: (key) => Buffer.from('encrypted:' + key),
      decrypt: () => {
        throw new Error('must not decrypt while editing');
      },
    });
    const provider = registry.saveProvider({
      name: 'Fixture',
      baseUrl: 'https://old.invalid/v1',
      protocol: 'gemini',
      apiKey: 'FAKE-TEST-KEY',
    });
    const before = db
      .prepare('SELECT encrypted_key FROM ai_providers WHERE id=?')
      .get(provider.id)!.encrypted_key;
    const next = registry.saveProvider({
      ...provider,
      baseUrl: 'https://new.invalid/proxy/v1beta',
      apiKey: '',
    });
    assert.equal(next.baseUrl, 'https://new.invalid/proxy/v1beta');
    assert.notEqual(next.revision, provider.revision);
    assert.deepEqual(
      db.prepare('SELECT encrypted_key FROM ai_providers WHERE id=?').get(provider.id)!
        .encrypted_key,
      before,
    );
    assert.equal(JSON.stringify(registry.catalog()).includes('FAKE-TEST-KEY'), false);
    assert.throws(
      () =>
        registry.saveProvider({
          name: 'New',
          baseUrl: 'https://new.invalid',
          protocol: 'gemini',
          apiKey: '',
        }),
      /API Key/,
    );
  } finally {
    db.close();
  }
});

test('provider protocol wins over legacy model overrides in both resolution and persistence', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const registry = new ConnectionRegistry(db, {
      encrypt: (key) => Buffer.from(key),
      decrypt: (key) => key.toString(),
    });
    const provider = registry.saveProvider({
      name: 'Fixture',
      baseUrl: 'https://example.invalid/v1',
      protocol: 'anthropic',
      apiKey: 'FAKE-TEST-KEY',
    });
    const model = registry.saveModel({
      providerId: provider.id,
      modelId: 'model',
      name: 'Model',
      protocol: 'chat-completions',
      capabilities: emptyCapabilities(),
      parameterSupport: emptyParameters(),
      parameters: {},
    });
    assert.equal(model.protocol, 'inherit');
    const resolved = modelConnection(provider, { ...model, protocol: 'gemini' });
    assert.equal(resolved.protocol, 'anthropic');
    assert.equal(resolved.endpoint, 'https://example.invalid/v1/messages');
    assert.equal(resolved.parameters?.maxCompletionTokens, 4096);
  } finally {
    db.close();
  }
});
