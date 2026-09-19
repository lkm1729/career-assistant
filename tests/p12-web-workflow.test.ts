import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWeb, webReadDiagnostic, webUrl } from '../electron/web-material';
import { MaterialStore } from '../electron/material-store';
import { runWebBatch } from '../src/web-import';
import { jobReviewSources, assertJobReview } from '../shared/job-review';

const resolve = async () => ['8.8.8.8'];
test('P12 extracts inert bounded titles and preserves original/final source without queries', async () => {
  let call = 0;
  const result = await readWeb(
    'https://jobs.example.com/original?id=12',
    new AbortController().signal,
    {
      resolve,
      download: async () =>
        ++call === 1
          ? { status: 302, location: '/final?tracking=1', contentType: '', body: '' }
          : {
              status: 200,
              contentType: 'text/html',
              body: '<script><title>FAKE</title></script><!--<title>COMMENT</title>--><title>Engineer &amp; Analyst</title><h1>Actual Role</h1><p>Python services and application testing experience are required.</p>',
            },
    },
  );
  assert.equal(result.title, 'Engineer & Analyst');
  assert.equal(result.url, 'https://jobs.example.com/original');
  assert.equal(result.retrievedUrl, 'https://jobs.example.com/final');
  assert.ok(!result.text.includes('FAKE'));
  const fallback = await readWeb(
    'https://jobs.example.com/no-title',
    new AbortController().signal,
    {
      resolve,
      download: async () => ({
        status: 200,
        contentType: 'text/html',
        body:
          '<h1>' +
          'Title '.repeat(100) +
          '</h1><p>Requirement body is long enough to be imported safely.</p>',
      }),
    },
  );
  assert.ok(fallback.title && fallback.title.length <= 240);
});
test('P12 batch continues after one failure; no automatic retry; cancellation skips pending links', async () => {
  const calls: string[] = [];
  const rows = await runWebBatch(
    ['one', 'bad', 'three'],
    async (url) => {
      calls.push(url);
      return url === 'bad'
        ? {
            ok: false,
            diagnostic: { code: 'WEB_NETWORK', message: 'safe', possibleCauses: [], solutions: [] },
          }
        : { ok: true, items: [] };
    },
    () => false,
    () => {},
    () => {},
  );
  assert.deepEqual(calls, ['one', 'bad', 'three']);
  assert.deepEqual(
    rows.map((r) => r.status),
    ['ready', 'failed', 'ready'],
  );
  let cancelled = false;
  const stopped = await runWebBatch(
    ['first', 'second', 'third'],
    async () => {
      cancelled = true;
      return {
        ok: false,
        diagnostic: {
          code: 'WEB_CANCELLED',
          message: 'cancelled',
          possibleCauses: [],
          solutions: [],
        },
      };
    },
    () => cancelled,
    () => {},
    () => {},
  );
  assert.deepEqual(
    stopped.map((r) => r.status),
    ['cancelled', 'skipped', 'skipped'],
  );
});
test('P12 snapshots and local fallback preserve provenance, opt in, ownership and reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'p12-provenance-')), 'db');
  let store = new MaterialStore(path);
  try {
    const [web] = store.importWeb('match', 'job', {
      url: 'https://jobs.example.com/a',
      retrievedUrl: 'https://jobs.example.com/b',
      title: 'Engineer',
      text: 'Job requirements',
      warnings: [],
    });
    assert.equal(web.name, '网页 · Engineer');
    assert.equal(web.sourceTitle, 'Engineer');
    assert.equal(web.retrievedUrl, 'https://jobs.example.com/b');
    assert.equal(web.selected, false);
    const local = store
      .importText('match', 'evidence', {
        title: 'Portfolio text',
        text: 'My independent evidence',
        sourceUrl: 'https://portfolio.example.com/work?id=1',
      })
      .at(-1)!;
    assert.equal(local.sourceKind, 'pasted');
    assert.equal(local.sourceUrl, 'https://portfolio.example.com/work');
    assert.equal(local.selected, false);
    assert.equal(store.list('letter').length, 0);
    const [scoreJob] = store.importText('score', 'job', {
      title: 'Score job',
      text: 'Fictional job',
    });
    assert.equal(scoreJob.workspace, 'score');
    assert.equal(scoreJob.selected, false);
    assert.equal(store.manifest('score', false).items.length, 0);
    assert.throws(() =>
      store.importText('match', 'evidence', {
        title: 'bad',
        text: 'x',
        sourceUrl: 'https://example.com/?token=secret',
      }),
    );
    store.update('match', web.id, web.revision, true);
    const m = store.manifest('match', false);
    assert.ok(
      !JSON.stringify(m.warnings).includes('Portfolio text'),
      'unselected names must not leak to wire warnings',
    );
    store.close();
    store = new MaterialStore(path);
    assert.equal(store.list('match').at(-1)?.sourceKind, 'pasted');
    assert.equal(store.list('match')[0].sourceTitle, 'Engineer');
  } finally {
    store.close();
  }
});
test('P12 job review counts sources, not PDF pages; explicit consent required only for multiple inputs', () => {
  const items = [
    { id: 'job', name: 'Two page PDF', purpose: 'job', pages: [{}, {}] },
    { id: 'evidence', name: 'Certificate', purpose: 'evidence', pages: [{}] },
  ];
  const sources = jobReviewSources({ items }, 'Pasted job');
  assert.equal(sources.length, 2);
  assert.throws(() => assertJobReview(sources, undefined), /确认/);
  assert.throws(() => assertJobReview(sources, 'true'), /确认/);
  assert.doesNotThrow(() => assertJobReview(sources, true));
  assert.doesNotThrow(() => assertJobReview(jobReviewSources({ items }, ''), undefined));
});

test('P12 invalid web addresses have web-only diagnostics without raw exceptions or provider billing advice', () => {
  try {
    webUrl('https://127.0.0.1/');
    assert.fail('must reject');
  } catch (error) {
    const d = webReadDiagnostic(error);
    assert.equal(d.code, 'WEB_READ_FAILED');
    assert.ok(d.message.includes('只读取公开'));
    assert.ok(!d.solutions.some((s) => s.includes('计费')));
  }
  const d = webReadDiagnostic(new Error('PRIVATE-REMOTE-BODY'));
  assert.ok(!JSON.stringify(d).includes('PRIVATE-REMOTE-BODY'));
});
