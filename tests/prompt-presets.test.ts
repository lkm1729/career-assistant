import { DatabaseSync } from 'node:sqlite';
import { emptyWorkspace } from '../shared/contracts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../electron/workspace-store';
import { workspaceIds } from '../shared/contracts';
test('P13 prompt copies are page-scoped, bounded, non-overwriting, persistent and independent of drafts', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'prompt-presets-')), 'db');
  let store = new WorkspaceStore(path);
  try {
    const before = store.load();
    for (const page of workspaceIds) {
      store.savePrompt(page, 'Own variant', page + ' CUSTOM PROMPT');
      assert.equal(store.listPrompts(page)[0].text, page + ' CUSTOM PROMPT');
      assert.throws(() => store.savePrompt(page, 'Own variant', 'replace'));
      assert.throws(() => store.savePrompt(page, '', 'invalid'));
      assert.throws(() => store.savePrompt(page, 'too long', 'x'.repeat(100001)));
    }
    assert.deepEqual(store.load(), before);
    store.close();
    store = new WorkspaceStore(path);
    for (const page of workspaceIds) assert.equal(store.listPrompts(page).length, 1);
    for (let i = 1; i < 20; i++) store.savePrompt('match', 'Variant ' + i, 'safe');
    assert.throws(() => store.savePrompt('match', 'overflow', 'safe'));
    assert.equal(store.listPrompts('letter').length, 1);
    assert.throws(() => store.listPrompts('other' as never));
  } finally {
    store.close();
  }
});

test('P13 upgrading an existing drafts database only adds prompt storage and preserves old payloads', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'prompt-upgrade-')), 'db');
  const db = new DatabaseSync(path);
  db.exec(
    'CREATE TABLE drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE preferences(id INTEGER PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE sentinel(id INTEGER PRIMARY KEY,payload BLOB);',
  );
  const original = JSON.stringify({
    ...emptyWorkspace('letter'),
    prompt: 'OLD USER PROMPT',
    systemPrompt: 'OLD USER SYSTEM',
    document: 'OLD MANUAL LETTER',
    resumeText: 'OLD CV',
  });
  db.prepare('INSERT INTO drafts VALUES(?,?)').run('letter', original);
  const bytes = Buffer.from('FAKE-ENCRYPTED-BYTES');
  db.prepare('INSERT INTO sentinel VALUES(1,?)').run(bytes);
  const store = new WorkspaceStore(path);
  try {
    assert.equal(store.readWorkspace('letter').systemPrompt, 'OLD USER SYSTEM');
    store.savePrompt('letter', 'New copy', 'NEW PRESET');
    assert.equal(
      db.prepare('SELECT payload FROM drafts WHERE id=?').get('letter')!.payload,
      original,
    );
    assert.deepEqual(
      Buffer.from(db.prepare('SELECT payload FROM sentinel').get()!.payload as Uint8Array),
      bytes,
    );
    assert.equal(store.listPrompts('resume').length, 0);
  } finally {
    store.close();
    db.close();
  }
});
