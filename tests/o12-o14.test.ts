import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FileImportDrafts } from '../electron/material-file-drafts';
import { materialLimits } from '../shared/materials';
import { o4Stores } from './o4-fixture';
import { seedO10 } from './o10-fixture';
import { o3Legacy } from './o3-fixture';
import { versionLabel } from '../shared/version-display';

test('O13 transferred bytes are bounded, opaque, page-scoped, cancellable and immutable until confirmation', async () => {
  const drafts = new FileImportDrafts();
  const original = new Uint8Array([65, 66]);
  const draft = drafts.createTransferred('resume', [{ name: '经历.txt', bytes: original }]);
  original[0] = 99;
  assert.deepEqual(Object.keys(draft.files[0]).sort(), ['id', 'name']);
  const assignment = [{ id: draft.files[0].id, purpose: 'evidence' as const }];
  assert.throws(() => drafts.take('match', draft.id, assignment));
  for (const file of [
    { name: '../secret.txt', bytes: original },
    { name: 'C:\\secret.txt', bytes: original },
    { name: 'run.exe', bytes: original },
    { name: 'empty.png', bytes: new Uint8Array() },
    { name: 'large.png', bytes: new Uint8Array(materialLimits.fileBytes + 1) },
  ])
    assert.throws(() => drafts.createTransferred('resume', [file]));
  assert.throws(() =>
    drafts.createTransferred('resume', Array(17).fill({ name: 'a.txt', bytes: original })),
  );
  const entries = drafts.take('resume', draft.id, assignment);
  assert.deepEqual(entries, [
    { name: '经历.txt', bytes: new Uint8Array([65, 66]), purpose: 'evidence' },
  ]);
  assert.throws(() => drafts.take('resume', draft.id, assignment));
  const { path } = seedO10(1);
  const f = o4Stores(path);
  try {
    const before = f.materials.list('resume').length;
    const result = await f.materials.importAssignedPaths(
      'resume',
      entries,
      async (_, bytes) => ({
        pages: [{ number: 1, text: bytes.toString(), source: 'text', warnings: [] }],
        totalPages: 1,
        warnings: [],
      }),
      new AbortController().signal,
    );
    assert.equal(result.length, before + 1);
    assert.equal(result.at(-1)!.selected, false);
    assert.equal(result.at(-1)!.purpose, 'evidence');
    assert.equal(result.at(-1)!.pages[0].text, 'AB');
    assert.equal(
      f.materials.list('score').some((item) => item.name === '经历.txt'),
      false,
    );
  } finally {
    f.close();
  }
});

for (const page of ['score', 'match'] as const) {
  test(`O14 ${page}: delete all history preserves exact current result across restart and clear/undo`, () => {
    const { path } = seedO10(3);
    let f = o4Stores(path);
    try {
      const store = page === 'score' ? f.scores : f.matches;
      const current = f.workspace.workbench.inspect(page);
      const input = f.workspace.readWorkspace(page);
      const materials = f.materials.list(page);
      store.deleteMany(
        store.list().map((r) => r.id),
        current.revision,
      );
      assert.equal(store.list().length, 0);
      assert.deepEqual(f.workspace.workbench.inspect(page).assessment, current.assessment);
      assert.equal(f.workspace.workbench.inspect(page).currentId, current.currentId);
      assert.equal(f.workspace.workbench.inspect(page).hasResult, true);
      assert.throws(() => store.deleteMany([current.currentId!], current.revision));
      f.close();
      f = o4Stores(path);
      assert.deepEqual(f.workspace.workbench.inspect(page).assessment, current.assessment);
      assert.deepEqual(f.workspace.readWorkspace(page), input);
      assert.deepEqual(f.materials.list(page), materials);
      const cleared = f.workspace.workbench.clear(f.workspace.workbench.inspect(page));
      assert.equal(cleared.hasResult, false);
      assert.equal(cleared.assessment, null);
      f.close();
      f = o4Stores(path);
      const restored = f.workspace.workbench.undo(f.workspace.workbench.inspect(page));
      assert.deepEqual(restored.assessment, current.assessment);
      assert.equal((page === 'score' ? f.scores : f.matches).list().length, 0);
    } finally {
      f.close();
    }
  });
}
for (const page of ['resume', 'letter'] as const) {
  test(`O14 ${page}: 20 to 10 to V11, delete all to V1, stable identity, recover and restart`, () => {
    const { path } = seedO10(19);
    let f = o4Stores(path);
    try {
      f.ai.recoverVersions(page, f.ai.historyState(page).deleted);
      const old = f.ai.listVersions(page);
      assert.equal(old.length, 20);
      assert.equal(old[0].displayNumber, 20);
      f.ai.deleteVersions(page, old.slice(10), f.workspace.readWorkspace(page));
      assert.equal(f.ai.listVersions(page)[0].displayNumber, 10);
      const next = f.ai.complete(
        { page, runId: randomUUID(), revision: 'fixture', input: f.workspace.readWorkspace(page) },
        o3Legacy.connection,
        { document: 'new after deletion', suggestions: '', rationale: '' },
      );
      assert.equal(next.displayNumber, 11);
      assert.equal(next.number, 21); // identity is deliberately NOT reused
      assert.equal(next.parentNumber, old[0].number);
      assert.equal(versionLabel(f.ai.listVersions(page), next.parentNumber), 'V10');
      f.workspace.workbench.clear(f.workspace.workbench.inspect(page));
      const all = f.ai.listVersions(page);
      f.ai.deleteVersions(page, all, f.workspace.readWorkspace(page));
      const first = f.ai.complete(
        { page, runId: randomUUID(), revision: 'fixture', input: f.workspace.readWorkspace(page) },
        o3Legacy.connection,
        { document: 'fresh first', suggestions: '', rationale: '' },
      );
      assert.equal(first.displayNumber, 1);
      f.ai.recoverVersions(page, [old.at(-1)!]);
      assert.equal(
        f.ai.listVersions(page).find((v) => v.number === first.number)!.displayNumber,
        2,
      );
      const recovered = f.ai.restoreVersion(
        old.at(-1)!.number,
        f.workspace.readWorkspace(page),
        page,
      );
      assert.equal(recovered.document, old.at(-1)!.document);
      assert.equal(recovered.displayNumber, 1);
      f.close();
      f = o4Stores(path);
      assert.equal(f.workspace.readWorkspace(page).currentVersionNumber, old.at(-1)!.number);
      assert.deepEqual(
        f.ai.listVersions(page).map((v) => v.displayNumber),
        [2, 1],
      );
      assert.match(versionLabel(f.ai.listVersions(page), next.number), /已移除版本/);
    } finally {
      f.close();
    }
  });
}
