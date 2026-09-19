import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdviceText } from '../src/Advice';
import { EvidenceQuote } from '../src/EvidenceQuote';
import { ResultHeader } from '../src/ResultHeader';
import { referenceLabels } from '../shared/reference-display';
const id = 'ae2a264b-ef9d-4f3c-9b4c-a31608ff5dd1:p1';
test('O9 rendered source names are literal and cannot create markup or network loads', () => {
  const title = '![track](https://track.test) <img src=x> **name**';
  const labels = referenceLabels(undefined, [{ id, name: title }]);
  const html = renderToStaticMarkup(createElement(AdviceText, { text: `依据 ${id}`, labels }));
  assert.doesNotMatch(html, /<(img|script|a|strong)\b|href=|src="/);
  assert.match(html, /\*\*name\*\*/);
  assert.match(html, /&lt;img src=x&gt;/);
});
test('O9 quotes preserve exact evidence with technical identity only in closed details', () => {
  const html = renderToStaticMarkup(
    createElement(EvidenceQuote, {
      sourceId: id,
      quote: '<script>literal evidence</script>',
      labels: referenceLabels(),
    }),
  );
  assert.match(html, /参考资料 · 第 1 页/);
  assert.match(
    html,
    /<details class="evidence-technical"><summary>引用技术详情<\/summary><code>ae2a/,
  );
  assert.doesNotMatch(html, /<script>|<details[^>]*open/);
  assert.match(html, /&lt;script&gt;literal evidence&lt;\/script&gt;/);
});
test('O9 result status only animates actual pending work', () => {
  const complete = renderToStaticMarkup(
    createElement(ResultHeader, { title: '简历', status: 'AI 正式结果' }),
  );
  const pending = renderToStaticMarkup(
    createElement(ResultHeader, { title: '简历', status: '正在生成', pending: true }),
  );
  assert.match(complete, /AI 回答区/);
  assert.doesNotMatch(complete, /class="[^"]*spin/);
  assert.match(pending, /class="[^"]*spin/);
});
