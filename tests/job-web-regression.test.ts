import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeb } from '../electron/web-material';
import { publicAiDiagnostic } from '../electron/ai-service';
const slug =
  '1789108699236-6aa3a1db177b02001da5e1b0-careerbridge-ai-agent-builder-trainee-ai-native-development-master-concept-hong-k';
const url = 'https://cityu.app.kinobi.asia/jobs/' + slug;
const data = {
  slug,
  title: 'Fictional engineer',
  description_text: 'Build reliable software with verifiable experience and documented testing.',
  requirements_text: [{ text: 'Python experience' }, { text: 'Ability to learn' }],
  responsibilities_text: [{ text: 'Write tests' }],
  company: { name: 'Fictional company', point_of_contacts: ['DO-NOT-COPY'] },
  to_email_addresses: ['DO-NOT-COPY'],
};
test('CityU SPA reads the exact public job resource without executing scripts or login', async () => {
  const requested: string[] = [];
  const result = await readWeb(url, new AbortController().signal, {
    resolve: async () => ['8.8.8.8'],
    download: async (target) => {
      requested.push(target.href);
      return target.hostname === 'cityu.server.kinobi.asia'
        ? { status: 200, contentType: 'application/json', body: JSON.stringify({ data }) }
        : {
            status: 200,
            contentType: 'text/html',
            body: '<title>CITYU</title><script>throw 1</script>',
          };
    },
  });
  assert.match(result.text, /Python experience/);
  assert.ok(!result.text.includes('DO-NOT-COPY'));
  assert.deepEqual(requested, ['https://cityu.server.kinobi.asia/api/job/' + slug + '/public']);
  assert.equal(result.url, url);
});
test('empty dynamic pages are diagnosed as web extraction rather than AI configuration', async () => {
  try {
    await readWeb('https://example.com/jobs', new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      download: async () => ({
        status: 200,
        contentType: 'text/html',
        body: '<title>JOBS</title>',
      }),
    });
    assert.fail();
  } catch (error) {
    assert.equal(publicAiDiagnostic(error).code, 'WEB_CONTENT_EMPTY');
  }
});

test('public adapter rejects mismatched jobs, private DNS, redirects and unsupported field shapes', async () => {
  for (const variant of [
    { ...data, slug: 'different' },
    { ...data, requirements_text: [{ html: 'Missing text field' }] },
  ]) {
    await assert.rejects(
      readWeb(url, new AbortController().signal, {
        resolve: async () => ['8.8.8.8'],
        download: async () => ({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: variant }),
        }),
      }),
      /公开岗位数据/,
    );
  }
  await assert.rejects(
    readWeb(url, new AbortController().signal, {
      resolve: async () => ['10.0.0.1'],
      download: async () => {
        assert.fail('must not send');
      },
    }),
    /内网/,
  );
  await assert.rejects(
    readWeb(url, new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      download: async () => ({ status: 302, location: '/api/login', contentType: '', body: '' }),
    }),
    /未自动跟随/,
  );
});
