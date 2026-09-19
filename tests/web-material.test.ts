import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, webUrl, webpageText, readWeb } from '../electron/web-material';
for (const address of [
  '127.0.0.1',
  '10.1.2.3',
  '100.100.100.200',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.2',
  '198.19.1.1',
  '224.0.0.1',
  '0.0.0.0',
  '::1',
  '::ffff:8.8.8.8',
  '2001:db8::1',
])
  test('web blocks reserved address ' + address, () => assert.equal(publicAddress(address), false));
test('public IPv4 and URL validation', () => {
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(webUrl('https://jobs.example.com/role#anchor').hash, '');
  for (const url of [
    'file:///x',
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com:444',
    'https://localhost',
    'https://a.local/',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::1]',
    'https://example.com/?token=secret',
    'https://example.com\n',
  ])
    assert.throws(() => webUrl(url), url);
});
test('web text strips scripts/styles and preserves readable evidence without HTML execution', () => {
  assert.equal(
    webpageText(
      '<h1>Role &amp; Team</h1><script>EVIL</script><style>HIDDEN</style><p>Python &#x32; years</p>',
      'text/html',
    ),
    'Role & Team\nPython 2 years',
  );
});
test('web pinning rejects DNS rebinding on redirects, mixed public/private answers, and cross-origin redirects', async () => {
  let calls = 0;
  await assert.rejects(
    readWeb('https://jobs.example.com/role', new AbortController().signal, {
      resolve: async () => (calls ? ['127.0.0.1'] : ['8.8.8.8']),
      download: async (_url, address) => {
        assert.equal(address, '8.8.8.8');
        calls++;
        return { status: 302, location: '/next', contentType: '', body: '' };
      },
    }),
    /内网/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    readWeb('https://jobs.example.com/role', new AbortController().signal, {
      resolve: async () => ['8.8.8.8', '10.0.0.1'],
      download: async () => {
        throw new Error('MUST NOT REQUEST');
      },
    }),
    /内网/,
  );
  await assert.rejects(
    readWeb('https://jobs.example.com/role', new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      download: async () => ({
        status: 302,
        location: 'https://other.example.com/next',
        contentType: '',
        body: '',
      }),
    }),
    /另一网站/,
  );
});
test('web snapshot only after complete response; cancellation, oversized/empty and redirect loops do not import', async () => {
  const resolve = async () => ['8.8.8.8'];
  const body =
    '<h1>Fictional Python software engineer</h1><p>Build Python services and test reliable applications.</p>';
  const result = await readWeb(
    'https://jobs.example.com/role?job=123',
    new AbortController().signal,
    { resolve, download: async () => ({ status: 200, contentType: 'text/html', body }) },
  );
  assert.match(result.text, /Python/);
  assert.equal(result.url, 'https://jobs.example.com/role');
  assert.deepEqual(result.warnings, []);
  for (const text of ['', 'x'.repeat(120001)])
    await assert.rejects(
      readWeb('https://jobs.example.com/', new AbortController().signal, {
        resolve,
        download: async () => ({ status: 200, contentType: 'text/plain', body: text }),
      }),
    );
  let count = 0;
  await assert.rejects(
    readWeb('https://jobs.example.com/', new AbortController().signal, {
      resolve,
      download: async () => {
        count++;
        return { status: 302, location: '/again', contentType: '', body: '' };
      },
    }),
    /超过3次/,
  );
  assert.equal(count, 4);
  const controller = new AbortController();
  const pending = readWeb('https://jobs.example.com/', controller.signal, {
    resolve: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(pending, /取消/);
});

test('malformed unclosed HTML stays bounded and never exposes script bodies', () => {
  assert.equal(webpageText('<p>Role</p><script>' + '<script>'.repeat(100000), 'text/html'), 'Role');
  assert.equal(webpageText('<'.repeat(1000000), 'text/html'), '');
});

test('web network failures and cancellation never masquerade as supplier timeout or billing', async () => {
  const { publicAiDiagnostic } = await import('../electron/ai-service');
  await assert.rejects(
    readWeb('https://example.com/', new AbortController().signal, {
      resolve: async () => {
        throw new Error('PRIVATE NETWORK BODY');
      },
    }),
    (error) => {
      const d = publicAiDiagnostic(error);
      assert.equal(d.code, 'WEB_NETWORK');
      assert.ok(!JSON.stringify(d).includes('PRIVATE'));
      assert.ok(d.message.includes('尚未调用模型'));
      return true;
    },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readWeb('https://example.com/', controller.signal), (error) => {
    assert.equal(publicAiDiagnostic(error).code, 'WEB_CANCELLED');
    return true;
  });
});
