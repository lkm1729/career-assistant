import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { o4Stores } from './o4-fixture';
import { seedO10 } from './o10-fixture';
import type { WritingPage } from '../shared/ai';

for (const page of ['score', 'match'] as const) {
  test(`O10 ${page} deletion: atomic validation, current retained, independent input and restart`, () => {
    const { path } = seedO10(3);
    let f = o4Stores(path);
    try {
      const store = page === 'score' ? f.scores : f.matches;
      const rows = store.list(),
        current = f.workspace.workbench.inspect(page);
      const untouched = f.workspace.load(),
        materials = f.materials.list(page),
        config = f.ai.registry.catalog();
      for (const ids of [
        [],
        [rows[0].id, rows[0].id],
        [rows[0].id, 'missing'],
        [rows[0].id, page === 'score' ? 'match-o10-1' : 'score-o10-1'],
      ]) {
        assert.throws(() => store.deleteMany(ids, current.revision));
        assert.deepEqual(store.list(), rows);
        assert.deepEqual(f.workspace.workbench.inspect(page), current);
      }
      assert.throws(() => store.deleteMany([rows[0].id], 'stale'));
      assert.deepEqual(store.deleteMany([rows[0].id, rows[1].id], current.revision), {
        deleted: 2,
      });
      assert.equal(f.workspace.workbench.inspect(page).currentId, rows[0].id);
      assert.equal(store.list().length, 1);
      assert.deepEqual(f.workspace.load(), untouched);
      assert.deepEqual(f.materials.list(page), materials);
      assert.deepEqual(f.ai.registry.catalog(), config);
      assert.equal((page === 'score' ? f.matches : f.scores).list().length, 3);
      f.close();
      f = o4Stores(path);
      assert.equal(f.workspace.workbench.inspect(page).currentId, rows[0].id);
      const remaining = page === 'score' ? f.scores : f.matches;
      assert.equal(remaining.list().length, 1);
      remaining.deleteMany(
        remaining.list().map((r) => r.id),
        f.workspace.workbench.inspect(page).revision,
      );
      assert.equal(remaining.list().length, 0);
    } finally {
      f.close();
    }
  });
  test(`O10 ${page} deletion preserves unrelated and deleted Undo snapshots`, () => {
    const { path } = seedO10(3);
    const f = o4Stores(path);
    try {
      const store = page === 'score' ? f.scores : f.matches,
        rows = store.list();
      f.workspace.workbench.clear(f.workspace.workbench.inspect(page));
      store.deleteMany([rows[2].id], f.workspace.workbench.inspect(page).revision);
      assert.equal(f.workspace.workbench.inspect(page).canUndo, true);
      f.workspace.workbench.undo(f.workspace.workbench.inspect(page));
      assert.equal(f.workspace.workbench.inspect(page).currentId, rows[0].id);
      f.workspace.workbench.clear(f.workspace.workbench.inspect(page));
      store.deleteMany([rows[0].id], f.workspace.workbench.inspect(page).revision);
      assert.equal(f.workspace.workbench.inspect(page).canUndo, true);
      assert.equal(
        f.workspace.workbench.undo(f.workspace.workbench.inspect(page)).currentId,
        rows[0].id,
      );
    } finally {
      f.close();
    }
  });
  test(`O10 ${page} legacy installation and SQL failure rollback`, () => {
    const { path } = seedO10(3);
    const f = o4Stores(path);
    const db = new DatabaseSync(path);
    try {
      db.prepare('DELETE FROM workbench_results WHERE page=?').run(page);
      const store = page === 'score' ? f.scores : f.matches,
        rows = store.list();
      assert.equal(f.workspace.workbench.inspect(page).revision, 'initial');
      // Deliberate storage failure seam, not a production fault-injection API.
      db.exec(
        `CREATE TRIGGER o10_failure BEFORE DELETE ON ${page}_records WHEN OLD.id='${rows[1].id}' BEGIN SELECT RAISE(ABORT,'isolated disk failure'); END;`,
      );
      assert.throws(
        () => store.deleteMany([rows[0].id, rows[1].id], 'initial'),
        /isolated disk failure/,
      );
      assert.deepEqual(store.list(), rows);
      assert.equal(f.workspace.workbench.inspect(page).revision, 'initial');
      db.exec('DROP TRIGGER o10_failure');
      store.deleteMany([rows[0].id], 'initial');
      assert.equal(f.workspace.workbench.inspect(page).currentId, rows[0].id);
    } finally {
      db.close();
      f.close();
    }
  });
}
for (const page of ['resume', 'letter'] as const) {
  test(`O10 ${page} purge and drafts only delete selected local backups, keep numbering and current`, () => {
    const { path } = seedO10(3);
    let f = o4Stores(path);
    try {
      const history = f.ai.historyState(page),
        draft = f.workspace.readWorkspace(page),
        other: WritingPage = page === 'resume' ? 'letter' : 'resume';
      const otherHistory = f.ai.historyState(other);
      for (const items of [
        [history.deleted[0], history.deleted[0]],
        [history.deleted[0], { number: 999, runId: 'missing' }],
        [f.ai.historyState(other).deleted[0]],
        [history.versions[0]],
      ]) {
        assert.throws(() => f.ai.purgeVersions(page, items));
        assert.deepEqual(f.ai.historyState(page), history);
      }
      for (const ids of [
        [],
        [history.checkpoints[0].id, history.checkpoints[0].id],
        [history.checkpoints[0].id, otherHistory.checkpoints[0].id],
        [history.checkpoints[0].id, 'missing'],
      ]) {
        assert.throws(() => f.ai.deleteDrafts(page, ids));
        assert.deepEqual(f.ai.historyState(page), history);
      }
      f.ai.purgeVersions(page, history.deleted);
      f.ai.deleteDrafts(
        page,
        history.checkpoints.map((r) => r.id),
      );
      assert.deepEqual(f.workspace.readWorkspace(page), draft);
      assert.deepEqual(f.ai.historyState(other), otherHistory);
      assert.equal(f.ai.historyState(page).deleted.length, 0);
      assert.equal(f.ai.historyState(page).checkpoints.length, 0);
      assert.equal(f.ai.historyState(page).versions[0].number, 4);
      f.close();
      f = o4Stores(path);
      assert.equal(f.ai.historyState(page).deleted.length, 0);
      assert.equal(f.ai.historyState(page).checkpoints.length, 0);
      assert.deepEqual(f.workspace.readWorkspace(page), draft);
    } finally {
      f.close();
    }
  });
  test(`O10 ${page} clearing then purging old version keeps independent Undo text but not phantom version`, () => {
    const { path } = seedO10(2);
    const f = o4Stores(path);
    try {
      const draft = f.workspace.readWorkspace(page),
        current = f.ai.listVersions(page)[0];
      f.workspace.workbench.clear(f.workspace.workbench.inspect(page));
      f.ai.deleteVersions(page, [current], f.workspace.readWorkspace(page));
      f.ai.purgeVersions(page, [current]);
      const checkpoint = f.ai.historyState(page).checkpoints[0];
      f.workspace.workbench.undo(f.workspace.workbench.inspect(page));
      assert.equal(f.workspace.readWorkspace(page).document, draft.document);
      assert.equal(f.workspace.readWorkspace(page).currentVersionNumber, null);
      f.ai.recoverDraft(page, checkpoint.id, f.workspace.readWorkspace(page));
      assert.equal(f.workspace.readWorkspace(page).currentVersionNumber, null);
      assert.equal(f.workspace.readWorkspace(page).document, draft.document);
    } finally {
      f.close();
    }
  });
}
test('O10 all means all beyond 500, not sequential partially committed chunks', () => {
  const { path } = seedO10(501);
  const f = o4Stores(path);
  try {
    for (const page of ['resume', 'letter'] as const) {
      const h = f.ai.historyState(page);
      assert.equal(h.deleted.length, 501);
      assert.equal(h.checkpoints.length, 501);
      f.ai.purgeVersions(page, h.deleted);
      f.ai.deleteDrafts(
        page,
        h.checkpoints.map((r) => r.id),
      );
      assert.equal(f.ai.historyState(page).deleted.length, 0);
      assert.equal(f.ai.historyState(page).checkpoints.length, 0);
    }
    for (const page of ['score', 'match'] as const) {
      const store = page === 'score' ? f.scores : f.matches;
      assert.equal(store.list().length, 501);
      store.deleteMany(
        store.list().map((r) => r.id),
        f.workspace.workbench.inspect(page).revision,
      );
      assert.equal(store.list().length, 0);
    }
  } finally {
    f.close();
  }
});
for (const page of ['resume', 'letter'] as const) {
  test(`O10 ${page} purge/draft failures roll back whole batch and stale selections never remove active versions`, () => {
    const { path } = seedO10(3);
    const f = o4Stores(path),
      db = new DatabaseSync(path);
    try {
      const before = f.ai.historyState(page),
        draft = f.workspace.readWorkspace(page);
      db.exec(
        `CREATE TRIGGER o10_trash_failure BEFORE DELETE ON ${page}_versions WHEN OLD.number=${before.deleted[1].number} BEGIN SELECT RAISE(ABORT,'isolated purge failure'); END;`,
      );
      assert.throws(() => f.ai.purgeVersions(page, before.deleted), /isolated purge failure/);
      assert.deepEqual(f.ai.historyState(page), before);
      db.exec('DROP TRIGGER o10_trash_failure');
      db.exec(
        `CREATE TRIGGER o10_draft_failure BEFORE DELETE ON document_checkpoints WHEN OLD.id='${before.checkpoints[1].id}' BEGIN SELECT RAISE(ABORT,'isolated checkpoint failure'); END;`,
      );
      assert.throws(
        () =>
          f.ai.deleteDrafts(
            page,
            before.checkpoints.map((c) => c.id),
          ),
        /isolated checkpoint failure/,
      );
      assert.deepEqual(f.ai.historyState(page), before);
      assert.deepEqual(f.workspace.readWorkspace(page), draft);
      db.exec('DROP TRIGGER o10_draft_failure');
      f.ai.recoverVersions(page, [before.deleted[0]]);
      assert.throws(() => f.ai.purgeVersions(page, before.deleted));
      assert.equal(f.ai.historyState(page).deleted.length, 2);
      assert.equal(f.ai.historyState(page).versions.length, 2);
      // Defensive guard for an imported inconsistent database/current pointer.
      f.workspace.saveWorkspace(page, { ...draft, currentVersionNumber: before.deleted[1].number });
      assert.throws(() => f.ai.purgeVersions(page, [before.deleted[1]]), /当前工作版本/);
      assert.equal(f.ai.historyState(page).deleted.length, 2);
    } finally {
      db.close();
      f.close();
    }
  });
}
test('O10 malformed version references cannot bypass identity validation', () => {
  const { path } = seedO10(2);
  const f = o4Stores(path);
  try {
    const before = f.ai.historyState('resume');
    for (const input of [
      null,
      {},
      [],
      [{}],
      [{ number: 999 }],
      [{ number: 0, runId: 'bad' }],
      [{ number: before.deleted[0].number }],
      [null],
    ]) {
      assert.throws(() => Reflect.apply(f.ai.purgeVersions, f.ai, ['resume', input]));
      assert.deepEqual(f.ai.historyState('resume'), before);
    }
    assert.throws(() => Reflect.apply(f.ai.purgeVersions, f.ai, ['score', before.deleted]));
    assert.throws(() =>
      Reflect.apply(f.ai.deleteDrafts, f.ai, ['match', before.checkpoints.map((r) => r.id)]),
    );
    assert.deepEqual(f.ai.historyState('resume'), before);
  } finally {
    f.close();
  }
});
