import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FileImportDrafts } from '../electron/material-file-drafts';

test('file picker exposes only opaque IDs/names; confirmation is scoped, bounded and one-use', () => {
  let now = 100;
  const drafts = new FileImportDrafts(() => now);
  const draft = drafts.create('match', ['/private/a/cv.txt', '/private/b/job.txt']);
  assert.deepEqual(
    draft.files.map((f) => f.name),
    ['cv.txt', 'job.txt'],
  );
  assert.ok(!JSON.stringify(draft).includes('/private'));
  const assignments = draft.files.map((f, i) => ({
    id: f.id,
    purpose: i ? ('job' as const) : ('resume' as const),
  }));
  assert.throws(() => drafts.take('letter', draft.id, assignments));
  assert.throws(() =>
    drafts.take('match', draft.id, [{ id: '/private/arbitrary', purpose: 'resume' }]),
  );
  assert.throws(() => drafts.take('match', draft.id, [assignments[0], assignments[0]]));
  assert.throws(() =>
    drafts.take('match', draft.id, [{ ...assignments[0], purpose: 'wrong' as never }]),
  );
  assert.deepEqual(drafts.take('match', draft.id, assignments), [
    { path: '/private/a/cv.txt', purpose: 'resume' },
    { path: '/private/b/job.txt', purpose: 'job' },
  ]);
  assert.throws(() => drafts.take('match', draft.id, assignments));
  const expired = drafts.create('resume', ['/private/project.txt']);
  now += 16 * 60 * 1000;
  assert.throws(() =>
    drafts.take('resume', expired.id, [{ id: expired.files[0].id, purpose: 'evidence' }]),
  );
  const cancelled = drafts.create('letter', ['/private/project.txt']);
  drafts.discard('letter', cancelled.id);
  assert.throws(() =>
    drafts.take('letter', cancelled.id, [{ id: cancelled.files[0].id, purpose: 'evidence' }]),
  );
  assert.throws(() => drafts.create('match', Array(17).fill('/private/cv.txt')));
});
