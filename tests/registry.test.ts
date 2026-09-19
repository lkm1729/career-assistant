import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ConnectionRegistry } from '../electron/connection-registry.js';
import { emptyCapabilities, emptyParameters } from '../shared/models.js';
const vault = {
  encrypt: (text: string) => Buffer.from('encrypted:' + text),
  decrypt: (data: Buffer) => data.toString().slice(10),
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  const registry = new ConnectionRegistry(db, vault);
  return { db, registry };
}
const provider = {
  name: '供应商',
  baseUrl: 'https://example.com/v1',
  apiKey: 'fake-key',
  protocol: 'chat-completions' as const,
};
function model(providerId: string, name = '模型') {
  return {
    providerId,
    modelId: name,
    name,
    protocol: 'inherit' as const,
    capabilities: emptyCapabilities(),
    parameterSupport: emptyParameters(),
    parameters: {},
  };
}
test('migrate the 0.2 connection once without decrypting its key or changing legacy drafts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE ai_connection(id INTEGER PRIMARY KEY, metadata TEXT NOT NULL, encrypted_key BLOB NOT NULL); CREATE TABLE drafts(id TEXT PRIMARY KEY,payload TEXT);',
  );
  const old = {
    providerName: '旧供应商',
    baseUrl: 'https://example.com/v1',
    endpoint: 'https://example.com/v1/chat/completions',
    modelId: 'old',
    modelName: '旧模型',
    protocol: 'chat-completions',
    hasKey: true,
    revision: 'legacy-revision',
  };
  db.prepare('INSERT INTO ai_connection VALUES(1,?,?)').run(
    JSON.stringify(old),
    vault.encrypt('legacy-key'),
  );
  db.prepare('INSERT INTO drafts VALUES(?,?)').run('letter', 'unchanged');
  let registry = new ConnectionRegistry(db, {
    ...vault,
    decrypt() {
      throw new Error('must not decrypt during migration');
    },
  });
  assert.equal(registry.catalog().providers.length, 1);
  assert.equal(registry.connection('resume')?.modelName, '旧模型');
  assert.equal(registry.connection('letter'), null);
  assert.equal(
    db.prepare("SELECT payload FROM drafts WHERE id='letter'").get()?.payload,
    'unchanged',
  );
  registry = new ConnectionRegistry(db, vault);
  assert.equal(registry.credentials('resume').apiKey, 'legacy-key');
  const p = registry.catalog().providers[0];
  registry.deleteItems({ kind: 'providers', items: [{ id: p.id, revision: p.revision }] });
  registry = new ConnectionRegistry(db, vault);
  assert.equal(registry.catalog().providers.length, 0);
  db.close();
});
test('multiple providers and models keep page selection, overrides and keys independent', () => {
  const { db, registry: r } = fixture();
  const p = r.saveProvider(provider);
  const q = r.saveProvider({ ...provider, name: '另一家', apiKey: 'other-key' });
  const a = r.saveModel({
    ...model(p.id, 'A'),
    parameterSupport: { ...emptyParameters(), temperature: true },
    parameters: { temperature: 0.5 },
  });
  const b = r.saveModel(model(q.id, 'B'));
  r.select('resume', a.id, { temperature: 0.1 }, r.catalog().pages.resume.revision);
  r.select('letter', b.id, {}, r.catalog().pages.letter.revision);
  assert.equal(r.credentials('resume').apiKey, 'fake-key');
  assert.equal(r.credentials('letter').apiKey, 'other-key');
  assert.deepEqual(r.connection('resume')?.parameters, { temperature: 0.1 });
  assert.deepEqual(r.connection('letter')?.parameters, {});
  assert.equal(r.catalog().models.find((m) => m.id === a.id)?.parameters.temperature, 0.5);
  assert.equal(JSON.stringify(r.catalog()).includes('fake-key'), false);
  db.close();
});

test('batch deletion is atomic, clears affected selections and does not delete drafts or version history', () => {
  const { db, registry: r } = fixture();
  db.exec(
    'CREATE TABLE drafts(id TEXT,payload TEXT);CREATE TABLE resume_versions(number INTEGER,payload TEXT);',
  );
  db.prepare('INSERT INTO drafts VALUES (?,?)').run('resume', 'keep draft');
  db.prepare('INSERT INTO resume_versions VALUES (?,?)').run(1, 'keep history');
  const p = r.saveProvider(provider);
  const a = r.saveModel(model(p.id, 'A'));
  const b = r.saveModel(model(p.id, 'B'));
  r.select('resume', a.id, {}, r.catalog().pages.resume.revision);
  r.select('score', b.id, {}, r.catalog().pages.score.revision);
  assert.throws(() =>
    r.deleteItems({
      kind: 'models',
      items: [
        { id: a.id, revision: a.revision },
        { id: b.id, revision: 'stale' },
      ],
    }),
  );
  assert.equal(r.catalog().models.length, 2);
  assert.equal(r.connection('resume')?.modelId, 'A');
  r.deleteItems({ kind: 'providers', items: [{ id: p.id, revision: p.revision }] });
  assert.equal(r.catalog().models.length, 0);
  assert.equal(r.connection('resume'), null);
  assert.equal(r.connection('score'), null);
  assert.equal(db.prepare('SELECT payload FROM drafts').get()?.payload, 'keep draft');
  assert.equal(db.prepare('SELECT payload FROM resume_versions').get()?.payload, 'keep history');
  db.close();
});
test('configuration edits invalidate test receipts and remove disabled parameter overrides', () => {
  const { db, registry: r } = fixture();
  let p = r.saveProvider(provider);
  let m = r.saveModel({
    ...model(p.id),
    parameterSupport: { ...emptyParameters(), temperature: true },
    parameters: { temperature: 0.5 },
  });
  r.select('resume', m.id, { temperature: 0.2 }, r.catalog().pages.resume.revision);
  const before = r.modelConnection(m.id).revision;
  r.recordTest(m.id, {
    kind: 'text',
    ok: true,
    checkedAt: '2026-09-15T00:00:00.000Z',
    revision: before,
    message: 'ok',
  });
  m = r.saveModel({ ...m, parameterSupport: emptyParameters(), parameters: {} });
  assert.deepEqual(r.catalog().pages.resume.overrides, {});
  assert.notEqual(r.modelConnection(m.id).revision, before);
  assert.equal(r.catalog().models[0].tests[0].revision, before);
  assert.throws(() =>
    r.recordTest(m.id, {
      kind: 'text',
      ok: true,
      checkedAt: 'now',
      revision: before,
      message: 'old',
    }),
  );
  assert.throws(() => r.saveProvider({ ...p, name: 'changed', apiKey: '', revision: 'stale' }));
  p = r.saveProvider({ ...p, baseUrl: 'https://other.example/v1', apiKey: '' });
  assert.equal(r.modelCredentials(m.id).apiKey, 'fake-key');
  p = r.saveProvider({ ...p, name: 'rename', apiKey: '' });
  assert.equal(r.modelCredentials(m.id).apiKey, 'fake-key');
  db.close();
});
test('invalid capabilities, out of range parameters and duplicate model IDs are rejected without changes', () => {
  const { db, registry: r } = fixture();
  const p = r.saveProvider(provider);
  const m = r.saveModel(model(p.id));
  assert.throws(() => r.saveModel(model(p.id)));
  assert.throws(() =>
    r.saveModel({
      ...model(p.id, 'bad'),
      capabilities: { ...emptyCapabilities(), images: 'yes' as never },
    }),
  );
  assert.throws(() =>
    r.saveModel({
      ...model(p.id, 'bad'),
      parameterSupport: { ...emptyParameters(), temperature: true },
      parameters: { temperature: 3 },
    }),
  );
  assert.throws(() =>
    r.select('resume', m.id, { temperature: 0.5 }, r.catalog().pages.resume.revision),
  );
  assert.throws(() => r.select('unknown' as never, m.id, {}, ''));
  assert.equal(r.catalog().models.length, 1);
  db.close();
});

test('provider-only Responses protocol, parameters and receipts persist without legacy overrides', () => {
  const { db, registry: r } = fixture();
  let p = r.saveProvider({
    ...provider,
    protocol: 'responses',
    baseUrl: 'https://example.com/proxy/v1/responses',
  });
  const inherited = r.saveModel({
    ...model(p.id, 'responses-model'),
    parameterSupport: { temperature: true, maxCompletionTokens: true, reasoningEffort: true },
    parameters: { temperature: 0.5, maxCompletionTokens: 4096, reasoningEffort: 'medium' },
  });
  const chat = r.saveModel({ ...model(p.id, 'chat-model'), protocol: 'chat-completions' });
  r.select('resume', inherited.id, { temperature: 0.2 }, r.catalog().pages.resume.revision);
  r.select('letter', chat.id, {}, r.catalog().pages.letter.revision);
  assert.equal(r.connection('resume')?.endpoint, 'https://example.com/proxy/v1/responses');
  assert.equal(r.connection('resume')?.protocol, 'responses');
  assert.equal(r.connection('resume')?.parameters?.temperature, 0.2);
  assert.equal(r.connection('letter')?.endpoint, 'https://example.com/proxy/v1/responses');
  const revision = r.modelConnection(inherited.id).revision;
  r.recordTest(inherited.id, {
    kind: 'text',
    ok: true,
    checkedAt: '2026-09-15T00:00:00Z',
    revision,
    message: 'ok',
  });
  assert.throws(
    () =>
      r.select(
        'resume',
        inherited.id,
        { maxCompletionTokens: 1 },
        r.catalog().pages.resume.revision,
      ),
    /至少为 16/,
  );
  p = r.saveProvider({ ...p, protocol: 'chat-completions', apiKey: '' });
  assert.equal(r.modelCredentials(inherited.id).apiKey, 'fake-key');
  p = r.saveProvider({ ...p, protocol: 'chat-completions', apiKey: 'replacement-test-key' });
  assert.equal(r.modelConnection(inherited.id).protocol, 'chat-completions');
  assert.notEqual(r.modelConnection(inherited.id).revision, revision);
  assert.equal(r.catalog().models.find((m) => m.id === inherited.id)?.tests[0].revision, revision);
  r.saveModel({ ...inherited, protocol: 'responses' });
  const reopened = new ConnectionRegistry(db, vault);
  assert.equal(reopened.connection('resume')?.protocol, 'chat-completions');
  assert.equal(reopened.connection('letter')?.protocol, 'chat-completions');
  assert.equal(reopened.credentials('resume').apiKey, 'replacement-test-key');
  db.close();
});
