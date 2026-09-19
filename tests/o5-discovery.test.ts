import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fetchModelPage, parseModelPage } from '../electron/model-discovery';
import { protocols } from '../shared/ai';
import { publicAiDiagnostic } from '../electron/ai-service';
import { httpDiagnostic, messageDiagnostic } from '../shared/diagnostics';
import { o4Stores, seedO4 } from './o4-fixture';
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const address = s.address();
  if (!address || typeof address === 'string') throw Error('address');
  return {
    url: `http://127.0.0.1:${address.port}/proxy/v1`,
    close: async () => {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    },
  };
}
function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
for (const protocol of protocols)
  test(`O5 ${protocol}: explicit GET, protocol auth, bounded page parsing, no material upload`, async () => {
    let hits = 0;
    const f = await server((req, res) => {
      hits++;
      assert.equal(req.method, 'GET');
      assert.equal(req.headers['content-length'], undefined);
      const url = new URL(req.url!, 'http://localhost');
      assert.equal(url.pathname, '/proxy/v1/models');
      const auth =
        protocol === 'gemini'
          ? 'x-goog-api-key'
          : protocol === 'anthropic'
            ? 'x-api-key'
            : 'authorization';
      assert.equal(req.headers[auth], auth === 'authorization' ? 'Bearer FAKE' : 'FAKE');
      for (const key of ['x-goog-api-key', 'x-api-key', 'authorization'])
        if (key !== auth) assert.equal(req.headers[key], undefined);
      if (protocol === 'gemini') {
        assert.equal(url.searchParams.get('pageToken'), 'opaque&?');
        json(res, {
          models: [{ name: 'models/model-a' }, { name: 'models/model-a' }],
          nextPageToken: 'next',
        });
      } else if (protocol === 'anthropic') {
        assert.equal(url.searchParams.get('after_id'), 'opaque&?');
        json(res, {
          data: [{ id: 'model-a', capabilities: { images: true } }, { id: 'model-a' }],
          has_more: true,
          last_id: 'next',
        });
      } else {
        assert.equal(url.search, '');
        json(res, { data: [{ id: 'model-a' }, { id: 'model-a' }] });
      }
    });
    try {
      const page = await fetchModelPage(
        f.url + '/models',
        protocol,
        'FAKE',
        new AbortController().signal,
        'opaque&?',
      );
      assert.deepEqual(page.models, [{ id: 'model-a', name: 'model-a' }]);
      assert.equal(hits, 1);
      assert.equal(
        page.next,
        protocol === 'gemini' || protocol === 'anthropic' ? 'next' : undefined,
      );
    } finally {
      await f.close();
    }
  });
for (const status of [301, 400, 401, 403, 404, 405, 429, 500, 502, 503])
  test(`O5 HTTP ${status}: preserve real status without raw bodies, redirects, or retries`, async () => {
    let hits = 0;
    const f = await server((_req, res) => {
      hits++;
      res.writeHead(status, {
        'content-type': 'application/json',
        location: '/secret?key=PRIVATE',
      });
      res.end('{"error":"PRIVATE BODY"}');
    });
    try {
      await assert.rejects(
        fetchModelPage(f.url, 'anthropic', 'FAKE', new AbortController().signal),
        (e) => {
          const d = publicAiDiagnostic(e);
          assert.equal(d.httpStatus, status);
          assert.equal(d.code, `AI_HTTP_${status}`);
          assert.ok(!JSON.stringify(d).includes('PRIVATE'));
          return true;
        },
      );
      assert.equal(hits, 1);
    } finally {
      await f.close();
    }
  });
test('O5 cancellation, timeout and local failures never fabricate HTTP status', async () => {
  const f = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  });
  try {
    const c = new AbortController();
    const promise = fetchModelPage(f.url, 'anthropic', 'FAKE', c.signal);
    setTimeout(() => c.abort(), 30);
    await assert.rejects(promise, (e) => {
      const d = publicAiDiagnostic(e);
      assert.equal(d.code, 'AI_CANCELLED');
      assert.equal(d.httpStatus, undefined);
      return true;
    });
    await assert.rejects(
      fetchModelPage(f.url, 'anthropic', 'FAKE', new AbortController().signal, undefined, 20),
      (e) => {
        assert.equal(publicAiDiagnostic(e).code, 'AI_TIMEOUT');
        assert.equal(publicAiDiagnostic(e).httpStatus, undefined);
        return true;
      },
    );
    assert.equal(messageDiagnostic('本地操作失败').httpStatus, undefined);
    assert.notEqual(httpDiagnostic(500).message, httpDiagnostic(502).message);
  } finally {
    await f.close();
  }
});
test('O5 rejects malformed, hostile IDs and unknown pagination; normalizes Gemini names and empty lists', () => {
  for (const body of [
    null,
    {},
    [],
    { data: [null], has_more: false },
    { data: [{ id: 'bad\nID' }], has_more: false },
    { data: [{ id: 'bad?key=SECRET' }], has_more: false },
    { data: [], has_more: true, last_id: '' },
  ])
    assert.throws(() => parseModelPage(body, 'anthropic'));
  assert.throws(() =>
    parseModelPage({ data: [], has_more: true, next: 'https://evil.test' }, 'chat-completions'),
  );
  assert.deepEqual(parseModelPage({ models: [] }, 'gemini').models, []);
  assert.deepEqual(parseModelPage({ data: [], has_more: false }, 'anthropic').models, []);
  assert.deepEqual(
    parseModelPage(
      {
        models: [
          {
            name: 'models/abc',
            displayName: 'UNTRUSTED',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      },
      'gemini',
    ).models,
    [{ id: 'abc', name: 'abc' }],
  );
});
test('O5 refuses HTML, malformed JSON and oversized lists without raw diagnostics', async () => {
  let mode = 0;
  const f = await server((_req, res) => {
    res.writeHead(200, { 'content-type': mode === 0 ? 'text/html' : 'application/json' });
    res.end(mode === 0 ? 'PRIVATE HTML' : mode === 1 ? 'PRIVATE JSON' : ' '.repeat(1_000_001));
  });
  try {
    for (mode = 0; mode < 3; mode++)
      await assert.rejects(
        fetchModelPage(f.url, 'anthropic', 'FAKE', new AbortController().signal),
        (e) => {
          assert.ok(!JSON.stringify(publicAiDiagnostic(e)).includes('PRIVATE'));
          return true;
        },
      );
  } finally {
    await f.close();
  }
});
test('O5 service pagination, deduped atomic import, stale guards, global lock, and persisted isolation', async () => {
  let page = 0;
  let hold = false;
  let started = () => {};
  const remote = await server((req, res) => {
    started();
    if (hold) return;
    const url = new URL(req.url!, 'http://localhost');
    if (!url.searchParams.has('after_id')) {
      page++;
      json(res, { data: [{ id: 'a' }, { id: 'b' }], has_more: true, last_id: 'b' });
    } else json(res, { data: [{ id: 'b' }, { id: 'c' }], has_more: false });
  });
  mkdirSync('.test-data', { recursive: true });
  const path = join(mkdtempSync(resolve('.test-data/o5-unit-')), 'db');
  seedO4(path);
  let f = o4Stores(path);
  try {
    const p = f.ai.registry.saveProvider({
      name: 'Discovery',
      baseUrl: remote.url,
      protocol: 'anthropic',
      apiKey: 'FAKE',
    });
    const before = f.workspace.load();
    const pages = f.ai.registry.catalog().pages;
    const scores = f.scores.list();
    const matches = f.matches.list();
    const first = await f.service.discoverModels(p.id, p.revision);
    assert.equal(first.hasMore, true);
    assert.equal(f.ai.registry.catalog().models.length, 0);
    const all = await f.service.discoverModels(p.id, p.revision, first.session);
    assert.deepEqual(
      all.models.map((m) => m.id),
      ['a', 'b', 'c'],
    );
    assert.equal(all.hasMore, false);
    assert.throws(() => f.service.importModels(all.session, ['a', 'unknown']));
    assert.equal(f.ai.registry.catalog().models.length, 0);
    f.service.importModels(all.session, ['a', 'b', 'a']);
    const saved = f.ai.registry.catalog().models;
    assert.equal(saved.length, 2);
    f.service.importModels(all.session, ['a', 'b', 'c']);
    assert.equal(f.ai.registry.catalog().models.length, 3);
    assert.deepEqual(f.ai.registry.catalog().models.slice(0, 2), saved);
    for (const m of f.ai.registry.catalog().models) {
      assert.deepEqual(m.tests, []);
      assert.deepEqual(m.parameters, {});
      assert.ok(Object.values(m.capabilities).every((v) => v === 'unknown'));
      assert.ok(Object.values(m.parameterSupport).every((v) => v === false));
    }
    assert.deepEqual(f.ai.registry.catalog().pages, pages);
    assert.deepEqual(f.workspace.load(), before);
    assert.deepEqual(f.scores.list(), scores);
    assert.deepEqual(f.matches.list(), matches);
    assert.equal(f.ai.registry.catalog().providers[0].test, undefined);
    hold = true;
    const start = new Promise<void>((r) => {
      started = r;
    });
    const pending = f.service.discoverModels(p.id, p.revision);
    await start;
    assert.throws(() => f.service.importModels(all.session, ['a']), /运行/);
    assert.throws(
      () => f.service.changeWorkbench('clear', f.workspace.workbench.inspect('resume')),
      /运行/,
    );
    f.service.cancelTest();
    await assert.rejects(pending, /取消/);
    hold = false;
    const fresh = await f.service.discoverModels(p.id, p.revision);
    f.ai.registry.saveProvider({ ...p, name: 'Changed', apiKey: '' });
    assert.throws(() => f.service.importModels(fresh.session, ['b']), /变化/);
    f.close();
    f = o4Stores(path);
    assert.equal(f.ai.registry.catalog().models.length, 3);
    assert.deepEqual(f.workspace.load(), before);
    assert.throws(() => f.service.importModels(fresh.session, ['a']), /过期/);
  } finally {
    f.close();
    await remote.close();
  }
});
test('O5 cursor loop rejection preserves prior page; registry capacity import is atomic', async () => {
  const remote = await server((_req, res) =>
    json(res, { data: [{ id: 'a' }, { id: 'b' }], has_more: true, last_id: 'repeat' }),
  );
  mkdirSync('.test-data', { recursive: true });
  const f = o4Stores(join(mkdtempSync(resolve('.test-data/o5-loop-')), 'db'));
  try {
    const p = f.ai.registry.saveProvider({
      name: 'Loop',
      baseUrl: remote.url,
      protocol: 'anthropic',
      apiKey: 'FAKE',
    });
    const first = await f.service.discoverModels(p.id, p.revision);
    await assert.rejects(f.service.discoverModels(p.id, p.revision, first.session), /重复/);
    f.ai.registry.importDiscovered(
      p.id,
      p.revision,
      Array.from({ length: 499 }, (_, i) => `model-${i}`),
    );
    assert.throws(() => f.service.importModels(first.session, ['a', 'b']), /500/);
    assert.equal(f.ai.registry.catalog().models.length, 499);
    f.service.importModels(first.session, ['a']);
    assert.equal(f.ai.registry.catalog().models.length, 500);
  } finally {
    f.close();
    await remote.close();
  }
});

test('O5 20-page bound and 5000-model bound stop without advancing the retained session', async () => {
  let huge = false;
  let hits = 0;
  const remote = await server((_req, res) => {
    hits++;
    json(res, {
      data: huge
        ? Array.from({ length: 5000 }, (_, i) => ({ id: `large-${i}` }))
        : [{ id: `item-${hits}` }],
      has_more: true,
      last_id: `cursor-${hits}`,
    });
  });
  const f = o4Stores(join(mkdtempSync(resolve('.test-data/o5-bounds-')), 'db'));
  try {
    const p = f.ai.registry.saveProvider({
      name: 'Bounds',
      baseUrl: remote.url,
      protocol: 'anthropic',
      apiKey: 'FAKE',
    });
    let page = await f.service.discoverModels(p.id, p.revision);
    for (let i = 1; i < 20; i++)
      page = await f.service.discoverModels(p.id, p.revision, page.session);
    assert.equal(page.pages, 20);
    const before = hits;
    await assert.rejects(f.service.discoverModels(p.id, p.revision, page.session), /20 页/);
    assert.equal(hits, before);
    const fresh = await f.service.discoverModels(p.id, p.revision);
    huge = true;
    await assert.rejects(f.service.discoverModels(p.id, p.revision, fresh.session), /5000/);
    f.service.importModels(fresh.session, [fresh.models[0].id]);
    assert.equal(f.ai.registry.catalog().models.length, 1);
  } finally {
    f.close();
    await remote.close();
  }
});
test('O5 pre-cancel sends no request, and misleading JSON media type is refused', async () => {
  let hits = 0;
  const remote = await server((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json-evil' });
    res.end('{"data":[],"has_more":false}');
  });
  try {
    const c = new AbortController();
    c.abort();
    await assert.rejects(fetchModelPage(remote.url, 'anthropic', 'FAKE', c.signal), /取消/);
    assert.equal(hits, 0);
    await assert.rejects(
      fetchModelPage(remote.url, 'anthropic', 'FAKE', new AbortController().signal),
      /未返回 JSON/,
    );
    assert.equal(hits, 1);
  } finally {
    await remote.close();
  }
});
