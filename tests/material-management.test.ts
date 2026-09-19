import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialStore, materialSnapshot } from '../electron/material-store';

const source = {
  url: 'https://example.com/project',
  text: 'Built a fictional project using TypeScript.',
  warnings: [],
};
test('per-item purpose persists, preserves evidence, and invalidates a previous sending confirmation', () => {
  const db = join(mkdtempSync(join(tmpdir(), 'o1-purpose-')), 'db');
  let store = new MaterialStore(db);
  try {
    const [first] = store.importWeb('match', 'job', source);
    store.update('match', first.id, first.revision, true);
    const before = store.manifest('match', false);
    const snapshot = materialSnapshot(before);
    const item = store.list('match')[0];
    assert.throws(() => store.setPurpose('letter', item.id, item.revision, 'resume'));
    assert.throws(() => store.setPurpose('match', item.id, item.revision, 'wrong' as never));
    const [changed] = store.setPurpose('match', item.id, item.revision, 'resume');
    assert.equal(changed.purpose, 'resume');
    assert.equal(changed.selected, true);
    assert.deepEqual(changed.pages, item.pages);
    assert.equal(changed.sourceUrl, source.url);
    assert.notEqual(changed.revision, item.revision);
    assert.throws(() => store.checked('match', before.revision, false), /资料在确认后已变化/);
    assert.throws(() => store.setPurpose('match', item.id, item.revision, 'job'), /资料已变化/);
    assert.equal(snapshot.items[0].purpose, 'job');
    store.close();
    store = new MaterialStore(db);
    assert.equal(store.list('match')[0].purpose, 'resume');
    assert.equal(store.list('letter').length, 0);
  } finally {
    store.close();
  }
});

test('batch removal validates every selection before changing any item and preserves old snapshots', () => {
  const db = join(mkdtempSync(join(tmpdir(), 'o1-remove-')), 'db');
  let store = new MaterialStore(db);
  try {
    store.importWeb('match', 'job', source);
    store.importWeb('match', 'resume', source);
    store.importWeb('letter', 'evidence', source);
    for (const item of store.list('match')) store.update('match', item.id, item.revision, true);
    const items = store.list('match');
    const before = store.manifest('match', false);
    const snapshot = materialSnapshot(before);
    assert.throws(() => store.removeMany('match', []), /选择/);
    assert.throws(() => store.removeMany('match', [items[0], items[0]]), /重复/);
    assert.throws(
      () => store.removeMany('match', [items[0], store.list('letter')[0]]),
      /资料已变化/,
    );
    assert.throws(
      () => store.removeMany('match', [items[0], { ...items[1], revision: 'stale' }]),
      /资料已变化/,
    );
    assert.equal(store.list('match').length, 2);
    assert.equal(store.manifest('match', false).revision, before.revision);
    assert.deepEqual(store.removeMany('match', items), []);
    assert.throws(() => store.checked('match', before.revision, false), /资料在确认后已变化/);
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0].pages[0].text, source.text);
    assert.equal(store.list('letter').length, 1);
    store.close();
    store = new MaterialStore(db);
    assert.equal(store.list('match').length, 0);
    assert.equal(store.list('letter').length, 1);
  } finally {
    store.close();
  }
});

test('one file import can assign separate purposes and leaves originals untouched, failed items unselected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'o1-files-'));
  const paths = ['cv.txt', 'job.txt', 'photo.png', 'bad.exe'].map((name) => join(dir, name));
  paths.forEach((path) => writeFileSync(path, 'original fixture'));
  const store = new MaterialStore(join(dir, 'db'));
  const purposes = ['resume', 'job', 'evidence', 'evidence'] as const;
  const parser = async () => ({
    pages: [{ number: 1, text: 'local parsed text', source: 'text' as const, warnings: [] }],
    totalPages: 1,
    warnings: [],
  });
  try {
    const entries = paths.map((path, i) => ({ path, purpose: purposes[i] }));
    const items = await store.importAssignedPaths(
      'match',
      entries,
      parser,
      new AbortController().signal,
    );
    assert.deepEqual(
      items.map((i) => i.purpose),
      purposes,
    );
    assert.deepEqual(
      items.map((i) => i.selected),
      [false, false, false, false],
    );
    assert.deepEqual(
      items.map((i) => i.status),
      ['ready', 'ready', 'ready', 'failed'],
    );
    assert.equal(store.list('resume').length, 0);
    await assert.rejects(
      store.importAssignedPaths(
        'match',
        [entries[0], { path: paths[1], purpose: 'invalid' as never }],
        parser,
        new AbortController().signal,
      ),
    );
    assert.equal(store.list('match').length, 4);
    store.removeMany('match', items);
    for (const path of paths) assert.equal(readFileSync(path, 'utf8'), 'original fixture');
  } finally {
    store.close();
  }
});

test('personal project and resume webpage fallback are independent opt-in materials in all four workspaces', () => {
  const store = new MaterialStore(join(mkdtempSync(join(tmpdir(), 'o1-project-')), 'db'));
  try {
    for (const page of ['resume', 'score', 'match', 'letter'] as const) {
      store.importText(page, 'evidence', {
        title: 'Personal project',
        text: 'Built the project.',
        sourceUrl: 'https://example.com/project?tracking=1',
      });
      store.importText(page, 'resume', { title: 'Online CV', text: 'My experience.' });
      const items = store.list(page);
      assert.equal(items.length, 2);
      assert.deepEqual(
        items.map((i) => i.purpose),
        ['evidence', 'resume'],
      );
      assert.equal(items[0].sourceUrl, 'https://example.com/project');
      assert.equal(store.manifest(page, false).items.length, 0);
    }
  } finally {
    store.close();
  }
});
