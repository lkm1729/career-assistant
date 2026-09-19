import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiStore } from '../electron/ai-store.js';
import { WorkspaceStore } from '../electron/workspace-store.js';
import type { WritingPage, ConnectionInfo } from '../shared/ai.js';
const connection: ConnectionInfo = {
  providerName: 'fixture',
  modelName: 'fixture',
  modelId: 'fake',
  baseUrl: 'https://example.invalid',
  endpoint: 'https://example.invalid/v1/messages',
  protocol: 'anthropic',
  hasKey: true,
  revision: 'fixture-revision',
};
for (const page of ['resume', 'letter'] as const) {
  test(`${page}: switching and rollback reuse the original number, retain drafts, and isolate the other page`, () => {
    const path = join(mkdtempSync(join(tmpdir(), 'career-history-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, { encrypt: Buffer.from, decrypt: (b) => b.toString() });
    const other: WritingPage = page === 'resume' ? 'letter' : 'resume';
    const complete = (document: string) => {
      const draft = workspace.readWorkspace(page);
      return store.complete(
        {
          page,
          runId: randomUUID(),
          revision: connection.revision,
          input: {
            prompt: draft.prompt,
            systemPrompt: draft.systemPrompt,
            document: draft.document,
          },
        },
        connection,
        { document, suggestions: 'advice', rationale: 'reason' },
      );
    };
    try {
      workspace.saveWorkspace(page, { ...workspace.readWorkspace(page), prompt: 'facts' });
      const otherBefore = workspace.readWorkspace(other);
      const v1 = complete('V1 text');
      complete('V2 text');
      complete('V3 text');
      const edited = workspace.saveWorkspace(page, {
        ...workspace.readWorkspace(page),
        document: 'manual unsaved-to-version text',
        refinement: 'pending',
      });
      const restored = store.restoreVersion(1, edited, page);
      assert.equal(restored.number, 1);
      assert.equal(store.listVersions(page).length, 3);
      assert.equal(workspace.readWorkspace(page).currentVersionNumber, 1);
      assert.equal(workspace.readWorkspace(page).document, v1.document);
      assert.deepEqual(workspace.readWorkspace(other), otherBefore);
      const checkpoint = store.historyState(page).checkpoints[0];
      assert.equal(checkpoint.draft.document, edited.document);
      store.recoverDraft(page, checkpoint.id, workspace.readWorkspace(page));
      assert.equal(workspace.readWorkspace(page).refinement, 'pending');
      assert.equal(workspace.readWorkspace(page).document, edited.document);
      const fresh = workspace.readWorkspace(page);
      workspace.saveWorkspace(page, { ...fresh, prompt: 'changed since confirmation' });
      assert.throws(() => store.restoreVersion(1, fresh, page), /改变/);
      store.restoreVersion(1, workspace.readWorkspace(page), page);
      const next = complete('new output from V1');
      assert.equal(next.number, 4);
      assert.equal(next.parentNumber, 1);
    } finally {
      store.close();
      workspace.close();
    }
  });
  test(`${page}: batch deletion is atomic and reversible and numbers are never reused`, () => {
    const path = join(mkdtempSync(join(tmpdir(), 'career-trash-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    let store = new AiStore(path, { encrypt: Buffer.from, decrypt: (b) => b.toString() });
    try {
      for (let i = 0; i < 3; i++) {
        const d = workspace.readWorkspace(page);
        store.complete({ page, runId: randomUUID(), revision: 'fixture', input: d }, connection, {
          document: `v${i + 1}`,
          suggestions: 'advice',
          rationale: 'reason',
        });
      }
      const [v3, v2, v1] = store.listVersions(page);
      assert.throws(
        () => store.deleteVersions(page, [v1, v3], workspace.readWorkspace(page)),
        /当前/,
      );
      assert.equal(store.historyState(page).deleted.length, 0);
      assert.throws(
        () =>
          store.deleteVersions(
            page,
            [v1, { ...v2, runId: 'stale' }],
            workspace.readWorkspace(page),
          ),
        /变化|不存在/,
      );
      assert.equal(store.listVersions(page).length, 3);
      store.deleteVersions(page, [v1, v2], workspace.readWorkspace(page));
      assert.deepEqual(
        store.listVersions(page).map((v) => v.number),
        [3],
      );
      assert.throws(
        () => store.restoreVersion(1, workspace.readWorkspace(page), page),
        /删除|不存在|找不到/,
      );
      store.close();
      store = new AiStore(path, { encrypt: Buffer.from, decrypt: (b) => b.toString() });
      assert.equal(store.historyState(page).deleted.length, 2);
      store.recoverVersions(page, [v1, v2]);
      assert.equal(store.listVersions(page).length, 3);
      assert.equal(workspace.readWorkspace(page).currentVersionNumber, 3);
    } finally {
      store.close();
      workspace.close();
    }
  });
}
