import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probeProvider } from '../electron/provider-probe.js';
import { providerProbeEndpoint } from '../shared/models.js';
import { protocols, AiError } from '../shared/ai.js';
import { publicAiDiagnostic } from '../electron/ai-service.js';
for (const protocol of protocols) {
  test(`${protocol}: provider probe preserves prefix, sends only protocol auth, and never generates`, async () => {
    let called = 0;
    const server = createServer((request, response) => {
      called++;
      assert.equal(request.method, 'GET');
      assert.equal(request.url, '/proxy/v1/models');
      const name =
        protocol === 'gemini'
          ? 'x-goog-api-key'
          : protocol === 'anthropic'
            ? 'x-api-key'
            : 'authorization';
      assert.equal(
        request.headers[name],
        name === 'authorization' ? 'Bearer FAKE-PROBE' : 'FAKE-PROBE',
      );
      for (const key of ['x-goog-api-key', 'x-api-key', 'authorization'])
        if (key !== name) assert.equal(request.headers[key], undefined);
      if (protocol === 'anthropic')
        assert.equal(request.headers['anthropic-version'], '2023-06-01');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(protocol === 'gemini' ? { models: [] } : { data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('address');
      const url = providerProbeEndpoint(`http://127.0.0.1:${address.port}/proxy/v1`, protocol);
      assert.match(
        await probeProvider(url, protocol, 'FAKE-PROBE', new AbortController().signal),
        /探针通过/,
      );
      assert.equal(called, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
test('provider failure diagnostics preserve status, discard secrets, refuse redirects and stop on cancel/timeout', async () => {
  let status = 401;
  let hits = 0;
  const server = createServer((request, response) => {
    hits++;
    if (status === 999) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{');
      return;
    }
    response.writeHead(status, { 'content-type': 'application/json', location: '/redirected' });
    response.end(JSON.stringify({ error: 'PRIVATE-SECRET-TEXT' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const url = `http://127.0.0.1:${address.port}/models`;
    for (status of [400, 401, 403, 404, 429, 500, 307]) {
      const before = hits;
      await assert.rejects(
        probeProvider(url, 'anthropic', 'FAKE', new AbortController().signal),
        (error) => {
          const diagnostic = publicAiDiagnostic(error);
          assert.equal(diagnostic.code, `AI_HTTP_${status}`);
          assert.equal(diagnostic.httpStatus, status);
          assert.ok(diagnostic.solutions.length);
          assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE-SECRET'));
          return true;
        },
      );
      assert.equal(hits, before + 1);
    }
    status = 999;
    await assert.rejects(
      probeProvider(url, 'gemini', 'FAKE', new AbortController().signal, 30),
      /超时/,
    );
    const controller = new AbortController();
    const pending = probeProvider(url, 'gemini', 'FAKE', controller.signal);
    controller.abort();
    await assert.rejects(pending, /取消/);
    assert.equal(
      publicAiDiagnostic(new Error('PRIVATE-TOKEN')).message.includes('PRIVATE-TOKEN'),
      false,
    );
    assert.equal(publicAiDiagnostic(new AiError('请求超过等待时间')).code, 'AI_TIMEOUT');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
