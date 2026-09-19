import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeb, webReadDiagnostic } from '../electron/web-material';
const url =
  'https://cityu.app.kinobi.asia/jobs/1789108696696-6aa3a1d8177b02001da5dff6-careerbridge-graduate-trainee-automated-system-h-k-limited-hk';
const slug = new URL(url).pathname.split('/').at(-1);
const response = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    data: {
      slug,
      title: 'Graduate Trainee',
      description_text: 'Build reliable software and automated systems with documented experience.',
      responsibilities_text: [{ text: 'Write tests' }],
      requirements_text: [{ text: 'Engineering experience' }],
    },
  }),
};

test('CityU observed Fake-IP is diagnosed without contacting target or public DNS without consent', async () => {
  await assert.rejects(
    readWeb(url, new AbortController().signal, {
      resolve: async () => ['198.18.0.213'],
      publicResolve: async () => {
        assert.fail('No DNS consent');
      },
      download: async () => {
        assert.fail('Must never connect to Fake-IP');
      },
    }),
    (error) => {
      assert.equal(webReadDiagnostic(error).code, 'WEB_DNS_SYNTHETIC');
      return true;
    },
  );
});

test('CityU observed Fake-IP imports only after explicit public DNS consent and pins public result', async () => {
  let dns = 0,
    downloads = 0;
  const result = await readWeb(
    url,
    new AbortController().signal,
    {
      resolve: async () => ['198.18.0.213'],
      publicResolve: async (host) => {
        dns++;
        assert.equal(host, 'cityu.server.kinobi.asia');
        return ['13.228.74.234'];
      },
      download: async (target, address) => {
        downloads++;
        assert.equal(target.hostname, 'cityu.server.kinobi.asia');
        assert.equal(address, '13.228.74.234');
        return response;
      },
    },
    true,
  );
  assert.equal(dns, 1);
  assert.equal(downloads, 1);
  assert.match(result.text, /Graduate Trainee/);
  assert.equal(result.url, url);
});

for (const system of [
  [],
  ['10.0.0.1'],
  ['198.18.0.213', '127.0.0.1'],
  ['198.18.0.213', '8.8.8.8'],
  ['::1'],
]) {
  test(
    'public DNS consent never relaxes system address blocking: ' + system.join(','),
    async () => {
      await assert.rejects(
        readWeb(
          url,
          new AbortController().signal,
          {
            resolve: async () => system,
            publicResolve: async () => {
              assert.fail('Not exclusively synthetic IPv4');
            },
            download: async () => {
              assert.fail('Unsafe download');
            },
          },
          true,
        ),
      );
    },
  );
}
for (const answers of [
  [],
  ['10.0.0.1'],
  ['8.8.8.8', '127.0.0.1'],
  ['198.18.0.213'],
  ['::ffff:8.8.8.8'],
]) {
  test(
    'public resolver cannot authorize reserved/mixed/unsupported addresses: ' + answers.join(','),
    async () => {
      let calls = 0;
      await assert.rejects(
        readWeb(
          url,
          new AbortController().signal,
          {
            resolve: async () => ['198.18.0.213'],
            publicResolve: async () => {
              calls++;
              return answers;
            },
            download: async () => {
              assert.fail('Unsafe download');
            },
          },
          true,
        ),
      );
      assert.equal(calls, 1);
    },
  );
}
test('normal public DNS uses the existing pinned transport even if consent is checked', async () => {
  const result = await readWeb(
    url,
    new AbortController().signal,
    {
      resolve: async () => ['8.8.8.8'],
      publicResolve: async () => {
        assert.fail('Unnecessary third-party query');
      },
      download: async (_url, ip) => {
        assert.equal(ip, '8.8.8.8');
        return response;
      },
    },
    true,
  );
  assert.match(result.text, /Graduate Trainee/);
});
test('invalid DNS consent rejects before any resolver runs', async () => {
  await assert.rejects(
    readWeb(
      url,
      new AbortController().signal,
      {
        resolve: async () => {
          assert.fail();
        },
      },
      'true' as never,
    ),
    /授权无效/,
  );
});
test('cancelling pending public DNS releases import without starting a download', async () => {
  const controller = new AbortController();
  await assert.rejects(
    readWeb(
      url,
      controller.signal,
      {
        resolve: async () => ['198.18.0.213'],
        publicResolve: async () => {
          controller.abort();
          return new Promise(() => {});
        },
        download: async () => {
          assert.fail('download after cancel');
        },
      },
      true,
    ),
    (error) => {
      assert.equal(webReadDiagnostic(error).code, 'WEB_CANCELLED');
      return true;
    },
  );
});
test('public DNS is revalidated on each same-origin hop, with no private target request', async () => {
  let dns = 0,
    download = 0;
  await assert.rejects(
    readWeb(
      'https://jobs.example.com/start',
      new AbortController().signal,
      {
        resolve: async () => ['198.19.0.1'],
        publicResolve: async () => (++dns === 1 ? ['8.8.8.8'] : ['127.0.0.1']),
        download: async () => {
          download++;
          return { status: 302, location: '/next', body: '', contentType: '' };
        },
      },
      true,
    ),
    /内网/,
  );
  assert.equal(dns, 2);
  assert.equal(download, 1);
});
test('CityU public adapter still refuses redirects with public DNS consent', async () => {
  await assert.rejects(
    readWeb(
      url,
      new AbortController().signal,
      {
        resolve: async () => ['198.18.0.213'],
        publicResolve: async () => ['8.8.8.8'],
        download: async () => ({ status: 302, location: '/api/login', body: '', contentType: '' }),
      },
      true,
    ),
    /未自动跟随/,
  );
});
import { publicDnsAnswers } from '../electron/web-dns';
const host = 'cityu.server.kinobi.asia';
const dns = (Answer: unknown[]) => ({
  Status: 0,
  TC: false,
  Question: [{ name: host, type: 1 }],
  Answer,
});
const a = { name: host, type: 1, data: '13.228.74.234' };
test('public DNS parses exact A question and CNAME chain, not unrelated records', () => {
  assert.deepEqual(publicDnsAnswers(dns([a, a]), host), [a.data]);
  assert.deepEqual(
    publicDnsAnswers(
      dns([
        { name: host, type: 5, data: 'LB.example.com.' },
        { name: 'lb.example.com', type: 1, data: '8.8.8.8' },
        { name: 'unrelated.example.com', type: 1, data: '127.0.0.1' },
      ]),
      host,
    ),
    ['8.8.8.8'],
  );
});
for (const value of [
  null,
  {},
  { ...dns([a]), Status: 3 },
  { ...dns([a]), TC: true },
  { ...dns([a]), Question: [{ name: 'other.example.com', type: 1 }] },
  { ...dns([a]), Question: [{ name: host, type: 28 }] },
  dns([]),
  dns([{ ...a, data: 'not-ip' }]),
  dns([{ ...a, data: '::1' }]),
  dns([a, { name: host, type: 5, data: 'lb.example.com' }]),
  dns([{ name: host, type: 5, data: host }]),
  dns([{ name: 'other.example.com', type: 1, data: '8.8.8.8' }]),
  dns([{ name: host, type: 5, data: 'https://evil.example.com/' }]),
  dns(Array.from({ length: 65 }, () => a)),
]) {
  test(
    'invalid or ambiguous DNS response never supplies an address: ' +
      JSON.stringify(value).slice(0, 100),
    () => {
      assert.throws(
        () => publicDnsAnswers(value, host),
        (error) => {
          assert.equal(webReadDiagnostic(error).code, 'WEB_PUBLIC_DNS_FAILED');
          return true;
        },
      );
    },
  );
}

import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mock } from 'node:test';
import { resolvePublicWebHost } from '../electron/web-dns';

test('DNS HTTPS transport pins resolver, sends only hostname, rejects redirects/oversize/invalid/error bodies', async () => {
  for (const variant of [
    'success',
    'redirect',
    'oversize',
    'invalid',
    'compressed',
    'aborted',
    'error',
  ] as const) {
    let calls = 0;
    const stub = mock.method(
      https,
      'request',
      (
        options: import('node:https').RequestOptions,
        callback: (response: import('node:http').IncomingMessage) => void,
      ) => {
        calls++;
        assert.equal(options.hostname, '1.1.1.1');
        assert.equal(options.servername, 'cloudflare-dns.com');
        assert.equal(options.port, 443);
        assert.equal(options.agent, false);
        assert.equal(options.path, '/dns-query?name=cityu.server.kinobi.asia&type=A');
        assert.equal(options.rejectUnauthorized, undefined);
        assert.deepEqual(options.headers, {
          Host: 'cloudflare-dns.com',
          Accept: 'application/dns-json',
          'Accept-Encoding': 'identity',
        });
        const req = new EventEmitter() as EventEmitter & { end: () => void };
        req.end = () =>
          queueMicrotask(() => {
            if (variant === 'error') {
              req.emit('error', new Error('PRIVATE-TRANSPORT-TOKEN'));
              return;
            }
            const res = Object.assign(new PassThrough(), {
              statusCode: variant === 'redirect' ? 302 : 200,
              headers: {
                'content-type': 'application/dns-json',
                ...(variant === 'compressed' ? { 'content-encoding': 'gzip' } : {}),
              },
            });
            callback(res as unknown as import('node:http').IncomingMessage);
            if (variant === 'aborted') {
              res.emit('aborted');
              res.destroy();
              return;
            }
            if (!res.destroyed)
              res.end(
                variant === 'oversize'
                  ? 'x'.repeat(32769)
                  : variant === 'invalid'
                    ? 'PRIVATE-TRANSPORT-TOKEN'
                    : JSON.stringify(dns([a])),
              );
          });
        return req as unknown as import('node:http').ClientRequest;
      },
    );
    syncBuiltinESMExports();
    try {
      const result = resolvePublicWebHost(host, new AbortController().signal);
      if (variant === 'success') assert.deepEqual(await result, [a.data]);
      else
        await assert.rejects(result, (error) => {
          const diagnostic = webReadDiagnostic(error);
          assert.equal(diagnostic.code, 'WEB_PUBLIC_DNS_FAILED');
          assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE-TRANSPORT-TOKEN/);
          return true;
        });
      assert.equal(calls, 1);
    } finally {
      stub.mock.restore();
      syncBuiltinESMExports();
    }
  }
});
