import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialStore, materialContent } from '../electron/material-store';
const parser = async () => ({
  pages: [{ number: 1, text: 'source text', source: 'text' as const, warnings: [] }],
  totalPages: 1,
  warnings: [],
});
test('materials import, opt-in, stale consent, reopen and workspace ownership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'materials-'));
  const file = join(dir, 'cv.txt');
  writeFileSync(file, 'source text');
  let store = new MaterialStore(join(dir, 'db.sqlite'));
  try {
    const items = await store.importPaths(
      'resume',
      'resume',
      [file],
      parser,
      new AbortController().signal,
    );
    assert.equal(items[0].selected, false);
    assert.equal(store.list('score').length, 0);
    assert.equal(store.manifest('resume', false).items.length, 0);
    assert.throws(() => store.update('score', items[0].id, items[0].revision, true));
    store.update('resume', items[0].id, items[0].revision, true);
    const manifest = store.manifest('resume', false);
    assert.equal(manifest.items.length, 1);
    assert.equal(materialContent(manifest).length, 1);
    const item = store.list('resume')[0];
    store.update('resume', item.id, item.revision, false);
    assert.throws(() => store.checked('resume', manifest.revision, false));
    assert.throws(() => store.update('resume', item.id, item.revision, true));
    store.close();
    store = new MaterialStore(join(dir, 'db.sqlite'));
    assert.equal(store.list('resume').length, 1);
    const current = store.list('resume')[0];
    store.update('resume', current.id, current.revision, false, true);
    assert.equal(store.list('resume').length, 0);
  } finally {
    store.close();
  }
});
test('per-item failures, file/count/text/image budgets and cancellation never silently send data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'materials-limits-'));
  const file = join(dir, 'cv.txt');
  writeFileSync(file, 'x');
  const invalid = join(dir, 'bad.exe');
  writeFileSync(invalid, 'x');
  const store = new MaterialStore(join(dir, 'db'));
  try {
    const items = await store.importPaths(
      'score',
      'resume',
      [invalid, file],
      parser,
      new AbortController().signal,
    );
    assert.equal(items[0].status, 'failed');
    assert.equal(items[1].status, 'ready');
    assert.throws(() => store.update('score', items[0].id, items[0].revision, true));
    await assert.rejects(
      store.importPaths(
        'score',
        'resume',
        Array(17).fill(file),
        parser,
        new AbortController().signal,
      ),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await store.importPaths('resume', 'resume', [file], parser, ctrl.signal);
    assert.equal(store.list('resume').length, 0);
    await store.importPaths(
      'resume',
      'resume',
      [file],
      async () => ({
        pages: [{ number: 1, text: 'x'.repeat(120001), source: 'text', warnings: [] }],
        totalPages: 1,
        warnings: [],
      }),
      new AbortController().signal,
    );
    assert.equal(store.list('resume')[0].status, 'failed');
  } finally {
    store.close();
  }
});
