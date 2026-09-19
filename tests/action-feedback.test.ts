import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionFeedback } from '../src/ActionFeedback';
test('action feedback only animates pending operations, exposes static status and supports cancellation', () => {
  const pending = renderToStaticMarkup(
    createElement(ActionFeedback, {
      label: '岗位匹配操作反馈',
      pending: true,
      message: '正在对照岗位要求…',
      cancelLabel: '停止本次匹配',
      onCancel: () => {},
    }),
  );
  assert.match(pending, /role="status"/);
  assert.match(pending, /aria-live="polite"/);
  assert.match(pending, /class="ai-thinking"/);
  assert.match(pending, /spin/);
  assert.match(pending, /停止本次匹配/);
  assert.doesNotMatch(pending, /progressbar|aria-valuenow/);
  const complete = renderToStaticMarkup(
    createElement(ActionFeedback, { label: '岗位匹配操作反馈', message: '已保存匹配结果。' }),
  );
  assert.match(complete, /已保存匹配结果/);
  assert.doesNotMatch(complete, /spin|ai-thinking/);
  assert.equal(
    renderToStaticMarkup(createElement(ActionFeedback, { label: '空状态', message: '' })),
    '',
  );
});

test('mirrored feedback does not repeat live announcements and cancelling disables its control', () => {
  const mirrored = renderToStaticMarkup(
    createElement(ActionFeedback, {
      label: '运行概况',
      pending: true,
      message: '<script>not HTML</script>',
      announce: false,
      onCancel: () => {},
      cancelling: true,
    }),
  );
  assert.doesNotMatch(mirrored, /role="status"|aria-live="polite"/);
  assert.match(mirrored, /aria-live="off"/);
  assert.match(mirrored, /disabled=""/);
  assert.match(mirrored, /&lt;script&gt;/);
  assert.doesNotMatch(mirrored, /<script>/);
  const failed = renderToStaticMarkup(
    createElement(ActionFeedback, { label: '操作反馈', message: '操作失败', error: true }),
  );
  assert.match(failed, /action-feedback-error/);
  assert.doesNotMatch(failed, /spin|ai-thinking/);
});
