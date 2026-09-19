import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdviceText, AdviceList } from '../src/Advice';

test('advice renders headings, bullets and bold keywords and formats old plain paragraphs as bullets', () => {
  const html = renderToStaticMarkup(
    createElement(AdviceText, {
      text: '## 优先建议\n- **成果**：补充数字。\n- **结构**：删掉重复内容。',
    }),
  );
  assert.match(html, /<h4>优先建议<\/h4>/);
  assert.match(html, /<li><strong>成果<\/strong>/);
  const legacy = renderToStaticMarkup(createElement(AdviceText, { text: '保持简洁\n\n补充成果' }));
  assert.match(legacy, /<ul>/);
  assert.equal((legacy.match(/<li>/g) ?? []).length, 2);
  const list = renderToStaticMarkup(
    createElement(AdviceList, { items: ['**关键词**：具体行动', '旧纯文本'] }),
  );
  assert.match(list, /<strong>关键词<\/strong>/);
  assert.match(list, /旧纯文本/);
});
test('advice never creates external loads, active links or executable HTML', () => {
  const html = renderToStaticMarkup(
    createElement(AdviceText, {
      text: '<script>alert(1)</script>\n\n![图片](https://private.example/track)\n\n[项目](https://private.example)\n\n[坏链接](javascript:alert(1))\n\n<iframe src="https://private.example" />',
    }),
  );
  assert.doesNotMatch(html, /<(script|iframe|img)\b|href=|src=|javascript:/i);
  assert.match(html, /项目/);
});
