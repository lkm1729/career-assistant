import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchPreview, MATCH_PREVIEW_LIMIT, MATCH_PREVIEW_TTL } from '../electron/match-preview';

test('preview is empty by default, run-scoped, one-shot and explicitly discardable', () => {
  const preview = new MatchPreview();
  assert.equal(preview.take('r1'), null);
  preview.set('r1', 'PRIVATE-RESPONSE', 'KEY');
  assert.equal(preview.has('r2'), false);
  assert.equal(preview.take({ runId: 'r1' }), null);
  preview.clear('r2');
  assert.equal(preview.take('r1')?.text, 'PRIVATE-RESPONSE');
  assert.equal(preview.take('r1'), null);
  preview.set('r1', 'OLD', 'KEY');
  preview.set('r2', 'NEW', 'KEY');
  assert.equal(preview.has('r1'), false);
  preview.clear();
  assert.equal(preview.has('r2'), false);
});
test('preview masks actual key including escaped forms before head/tail clipping', () => {
  const preview = new MatchPreview();
  const key = 'FAKE-KEY+/\\';
  const text =
    key +
    ' ' +
    JSON.stringify(key) +
    ' ' +
    encodeURIComponent(key) +
    'x'.repeat(MATCH_PREVIEW_LIMIT) +
    key;
  preview.set('r', text, key);
  const value = preview.take('r')!;
  assert.equal(value.truncated, true);
  assert.ok(value.text.length < MATCH_PREVIEW_LIMIT + 100);
  for (const secret of [key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)])
    assert.ok(!value.text.includes(secret));
  assert.match(value.text, /API KEY REDACTED/);
});
test('preview expires on read and new instances cannot recover it', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const preview = new MatchPreview();
  preview.set('r', 'PRIVATE', 'KEY');
  assert.equal(new MatchPreview().take('r'), null);
  t.mock.timers.setTime(1000 + MATCH_PREVIEW_TTL);
  assert.equal(preview.has('r'), false);
  assert.equal(preview.take('r'), null);
});
test('preview timer actively clears expired data without a read', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const preview = new MatchPreview();
  preview.set('r', 'PRIVATE', 'KEY');
  t.mock.timers.tick(MATCH_PREVIEW_TTL);
  t.mock.timers.setTime(1000);
  assert.equal(preview.has('r'), false);
});
