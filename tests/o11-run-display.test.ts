import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localRecordTime, sendSummary } from '../shared/run-display';
import { ConnectionBadge, Disclosure, HistoricalRunInfo } from '../src/RunInfo';
import { o3Legacy } from './o3-fixture';

test('O11 records use the saved instant with local timezone, never now', () => {
  const value = localRecordTime('2020-01-02T03:04:05Z');
  assert.equal(value.iso, '2020-01-02T03:04:05.000Z');
  assert.match(value.label, /2020/);
  assert.match(value.label, /GMT/);
});
test('O11 missing and malformed legacy timestamps have honest fallbacks', () => {
  assert.deepEqual(localRecordTime(undefined), { label: '未记录' });
  assert.deepEqual(localRecordTime('not-a-date'), { label: '时间不可用' });
});
test('O11 send summary counts only supplied input and selected manifest', () => {
  assert.deepEqual(sendSummary({ document: 'abc', prompt: '岗位' }, null), {
    inputCharacters: 5,
    materials: 0,
    images: 0,
    materialCharacters: 0,
  });
  assert.deepEqual(
    sendSummary(
      { refinement: '修改' },
      { revision: 'x', items: [], imageCount: 3, textCount: 22, warnings: [] },
    ),
    {
      inputCharacters: 2,
      materials: 0,
      images: 3,
      materialCharacters: 22,
    },
  );
});
test('O11 unopened disclosure does not mount sensitive or long preview text', () => {
  const html = renderToStaticMarkup(
    createElement(Disclosure, {
      title: 'preview',
      children: createElement('pre', null, 'PRIVATE-SENT-TEXT'),
    }),
  );
  assert.match(html, /preview/);
  assert.doesNotMatch(html, /PRIVATE-SENT-TEXT|<pre/);
});
test('O11 connection badge uses only display fields, never endpoint or parameters', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionBadge, {
      connection: {
        ...o3Legacy.connection,
        endpoint: 'https://private.invalid',
        modelName: '<script>alert(1)</script>',
        parameters: { maxCompletionTokens: 2000 },
      },
    }),
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /OpenAI Chat Completions/);
  assert.doesNotMatch(html, /private.invalid|maxCompletionTokens|<script>/);
  assert.match(html, /尚未配置密钥/);
});
test('O11 historic metadata does not claim a missing key in the current config', () => {
  const html = renderToStaticMarkup(createElement(HistoricalRunInfo, { record: o3Legacy }));
  assert.match(html, /2026-09-17T00:00:00.000Z/);
  assert.match(html, /fixture/);
  assert.doesNotMatch(html, /尚未配置密钥/);
});
test('O11 missing historic connection is not replaced with current settings', () => {
  assert.match(renderToStaticMarkup(createElement(HistoricalRunInfo, { record: {} })), /未记录/);
  assert.match(
    renderToStaticMarkup(createElement(ConnectionBadge, { connection: null })),
    /尚未选择模型/,
  );
});
