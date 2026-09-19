import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceStore } from '../electron/workspace-store.js';

test('a resume draft stays private to its tab and survives reopening', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-store-')), 'workspace.sqlite');
  const store = new WorkspaceStore(path);
  const draft = store.readWorkspace('resume');
  store.saveWorkspace('resume', { ...draft, prompt: '只属于简历的经历', document: '# 我的简历' });
  assert.equal(store.readWorkspace('match').prompt, '');
  store.close();
  const reopened = new WorkspaceStore(path);
  assert.equal(reopened.readWorkspace('resume').prompt, '只属于简历的经历');
  assert.equal(reopened.readWorkspace('resume').document, '# 我的简历');
  assert.equal(reopened.readWorkspace('letter').document, '');
  reopened.close();
});

test('invalid input cannot create another workspace or overwrite a saved draft', () => {
  const store = new WorkspaceStore(':memory:');
  const draft = store.readWorkspace('resume');
  store.saveWorkspace('resume', { ...draft, prompt: '保留我的内容' });
  assert.throws(() => store.saveWorkspace('unknown' as never, draft), /workspace/i);
  assert.throws(() => store.saveWorkspace('resume', { ...draft, prompt: 42 } as never), /prompt/i);
  assert.throws(
    () => store.saveWorkspace('resume', { ...draft, document: 'x'.repeat(500_001) }),
    /document/i,
  );
  assert.throws(() => store.readWorkspace('__proto__' as never), /workspace/i);
  assert.equal(store.readWorkspace('resume').prompt, '保留我的内容');
  store.close();
});

test('theme and selected tab survive reopening without changing draft content', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-prefs-')), 'workspace.sqlite');
  const store = new WorkspaceStore(path);
  store.savePreferences({ theme: 'dark', activeTab: 'letter' });
  store.close();
  const reopened = new WorkspaceStore(path);
  assert.deepEqual(reopened.load().preferences, { theme: 'dark', activeTab: 'letter' });
  assert.equal(reopened.load().workspaces.score.prompt, '');
  assert.throws(
    () => reopened.savePreferences({ theme: 'invalid', activeTab: 'resume' } as never),
    /theme/i,
  );
  reopened.close();
});
