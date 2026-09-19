import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceLabels, referenceLabel, readableReferences } from '../shared/reference-display';
const id = 'ae2a264b-ef9d-4f3c-9b4c-a31608ff5dd1';
const snapshot = {
  items: [
    { id, name: '项目简历.pdf', selected: true, pages: [{ number: 1 }, { number: 2 }] },
    { id: 'private', name: 'PRIVATE-UNSELECTED', selected: false, pages: [{ number: 1 }] },
  ],
};
test('O9 source captions use only selected historic snapshot names and actual page numbers', () => {
  const labels = referenceLabels(snapshot);
  assert.equal(referenceLabel(`${id}:p2`, labels), '项目简历.pdf · 第 2 页');
  assert.equal(referenceLabel('private:p1', labels), '参考资料 · 第 1 页');
  assert.ok(!JSON.stringify([...labels]).includes('PRIVATE-UNSELECTED'));
  assert.equal(referenceLabel('paste', labels), '本页简历文字');
  assert.equal(referenceLabel('job', labels), '本页岗位文字');
  assert.equal(referenceLabel('unknown', labels), '参考资料');
});
test('O9 legacy/malformed sources never guess a filename or display UUID fallback', () => {
  for (const invalid of [undefined, null, 'wrong', { items: [null, { id: {}, name: ['bad'] }] }]) {
    assert.equal(referenceLabel(`${id}:p9`, referenceLabels(invalid)), '参考资料 · 第 9 页');
  }
  const labels = referenceLabels(undefined, [{ id: 'legacy:p2', name: '当时岗位网页 第2页' }]);
  assert.equal(referenceLabel('legacy:p2', labels), '当时岗位网页 第2页');
});
test('O9 prose replaces technical references without changing ordinary words or original content', () => {
  const original = `## 建议\n引用 ${id}:p1；${id}:p2。job resume paste 2026 80%。`;
  const display = readableReferences(original, referenceLabels(snapshot));
  assert.equal(
    display,
    '## 建议\n引用 项目简历.pdf · 第 1 页；项目简历.pdf · 第 2 页。job resume paste 2026 80%。',
  );
  assert.ok(original.includes(id));
  assert.equal(readableReferences(`${id}:p7`, new Map()), '参考资料 · 第 7 页');
  assert.equal(readableReferences('s9:p1', new Map()), '参考资料 · 第 1 页');
});
test('O9 malicious snapshot names are treated as literal Markdown text, not images or HTML', () => {
  const labels = referenceLabels({
    items: [{ id, name: '![x](https://tracking.test)<img src=x>', pages: [{ number: 1 }] }],
  });
  const display = readableReferences(`${id}:p1`, labels, true);
  assert.ok(!display.includes('![x]('));
  assert.ok(!display.includes('<img'));
});
