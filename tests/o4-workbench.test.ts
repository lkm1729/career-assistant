import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { workspaceIds } from '../shared/contracts';
import { seedO4, o4Stores } from './o4-fixture';
import { o3Legacy } from './o3-fixture';
import { nativeFixture } from './native-fixture';
import { emptyCapabilities, emptyParameters } from '../shared/models';
function fixture() {
  mkdirSync('.test-data', { recursive: true });
  const path = join(mkdtempSync(resolve('.test-data/o4-unit-')), 'db');
  seedO4(path);
  return { path, ...o4Stores(path) };
}
for (const page of workspaceIds) {
  test(`${page}: clear/undo persists, preserves inputs/history/materials and other pages`, () => {
    const f = fixture();
    try {
      const before = f.workspace.load();
      const attachments = workspaceIds.map((p) => f.materials.list(p));
      const history = {
        score: f.scores.list(),
        match: f.matches.list(),
        resume: f.ai.listVersions('resume'),
        letter: f.ai.listVersions('letter'),
      };
      const expected = f.workspace.workbench.inspect(page);
      const cleared = f.service.changeWorkbench('clear', expected);
      assert.equal(cleared.hasResult, false);
      assert.equal(cleared.canUndo, true);
      assert.throws(() => f.service.changeWorkbench('clear', expected), /改变/);
      assert.throws(() => f.service.changeWorkbench('clear', cleared), /没有/);
      for (const other of workspaceIds.filter((p) => p !== page))
        assert.deepEqual(f.workspace.readWorkspace(other), before.workspaces[other]);
      const after = f.workspace.readWorkspace(page);
      for (const key of [
        'prompt',
        'systemPrompt',
        'refinement',
        'links',
        'resumeText',
        'evidenceText',
      ] as const)
        assert.equal(after[key], before.workspaces[page][key]);
      if (page === 'score' || page === 'match') assert.deepEqual(after, before.workspaces[page]);
      else {
        assert.equal(after.document, '');
        assert.equal(after.currentVersionNumber, null);
        assert.equal(
          f.ai.historyState(page).checkpoints[0].draft.document,
          before.workspaces[page].document,
        );
      }
      const reopened = o4Stores(f.path);
      try {
        assert.equal(reopened.workspace.workbench.inspect(page).hasResult, false);
        reopened.workspace.saveWorkspace(page, { ...after, prompt: 'NEW INPUT AFTER CLEAR' });
        const restored = reopened.service.changeWorkbench(
          'undo',
          reopened.workspace.workbench.inspect(page),
        );
        assert.equal(restored.hasResult, true);
        assert.equal(restored.canUndo, false);
        assert.equal(restored.draft.prompt, 'NEW INPUT AFTER CLEAR');
        assert.equal(restored.draft.document, before.workspaces[page].document);
      } finally {
        reopened.close();
      }
      assert.deepEqual(
        workspaceIds.map((p) => f.materials.list(p)),
        attachments,
      );
      assert.deepEqual(
        {
          score: f.scores.list(),
          match: f.matches.list(),
          resume: f.ai.listVersions('resume'),
          letter: f.ai.listVersions('letter'),
        },
        history,
      );
    } finally {
      f.close();
    }
  });
}
for (const page of ['resume', 'letter'] as const) {
  test(`${page}: edited drafts recover; new output invalidates undo; history remains recoverable`, () => {
    const f = fixture();
    try {
      f.workspace.saveWorkspace(page, {
        ...f.workspace.readWorkspace(page),
        document: 'MANUAL EDIT',
        refinement: 'KEEP REQUIREMENT',
      });
      const expected = f.workspace.workbench.inspect(page);
      f.service.changeWorkbench('clear', expected);
      const checkpoint = f.ai.historyState(page).checkpoints[0];
      assert.equal(checkpoint.draft.document, 'MANUAL EDIT');
      const cleared = f.workspace.workbench.inspect(page);
      f.workspace.saveWorkspace(page, { ...cleared.draft, document: 'NEW MANUAL' });
      assert.equal(f.workspace.workbench.inspect(page).canUndo, false);
      assert.throws(() => f.service.changeWorkbench('undo', cleared), /改变/);
      f.ai.recoverDraft(page, checkpoint.id, f.workspace.readWorkspace(page));
      assert.equal(f.workspace.readWorkspace(page).document, 'MANUAL EDIT');
      f.service.changeWorkbench('clear', f.workspace.workbench.inspect(page));
      const draft = f.workspace.readWorkspace(page);
      const version = f.ai.complete(
        { page, runId: randomUUID(), revision: 'fixture', input: draft },
        o3Legacy.connection,
        { document: 'NEW AI', suggestions: '', rationale: '' },
      );
      assert.equal(version.parentNumber, null);
      assert.equal(f.workspace.workbench.inspect(page).canUndo, false);
      assert.equal(f.ai.listVersions(page).length, 2);
    } finally {
      f.close();
    }
  });
  test(`${page}: stale confirm and storage failure cannot lose draft or checkpoint`, () => {
    const f = fixture();
    const db = new DatabaseSync(f.path);
    try {
      const expected = f.workspace.workbench.inspect(page);
      f.workspace.saveWorkspace(page, { ...expected.draft, document: 'later edit' });
      assert.throws(() => f.service.changeWorkbench('clear', expected), /改变/);
      const latest = f.workspace.workbench.inspect(page);
      db.exec(
        "CREATE TRIGGER fail_clear BEFORE INSERT ON workbench_results BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;",
      );
      assert.throws(() => f.service.changeWorkbench('clear', latest), /fixture storage failure/);
      assert.deepEqual(f.workspace.workbench.inspect(page), latest);
      assert.equal(f.ai.historyState(page).checkpoints.length, 0);
    } finally {
      db.close();
      f.close();
    }
  });
}
for (const page of ['score', 'match'] as const) {
  test(`${page}: legacy latest migrates to explicit empty, select and new success persist atomically`, () => {
    const f = fixture();
    const db = new DatabaseSync(f.path);
    try {
      db.prepare('DELETE FROM workbench_results WHERE page=?').run(page); // synthetic pre-O4 state only
      const legacy = f.workspace.workbench.inspect(page);
      assert.equal(legacy.revision, 'initial');
      assert.equal(legacy.hasResult, true);
      const cleared = f.service.changeWorkbench('clear', legacy);
      assert.equal(f.workspace.workbench.inspect(page).currentId, null);
      assert.throws(
        () => f.service.selectAssessment(page, 'other-page-id', cleared.revision),
        /找不到/,
      );
      const selected = f.service.selectAssessment(page, legacy.currentId!, cleared.revision);
      assert.equal(selected.currentId, legacy.currentId);
      assert.equal(selected.canUndo, false);
      assert.throws(() => f.service.changeWorkbench('undo', cleared), /改变/);
      const again = f.service.changeWorkbench('clear', selected);
      const record = page === 'score' ? f.scores.list()[0] : f.matches.list()[0];
      db.exec(
        "CREATE TRIGGER fail_selection BEFORE INSERT ON workbench_results BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;",
      );
      assert.throws(
        () =>
          page === 'score'
            ? f.scores.save({ ...f.scores.list()[0], id: 'new-record' })
            : f.matches.save({ ...f.matches.list()[0], id: 'new-record' }),
        /fixture storage failure/,
      );
      assert.equal((page === 'score' ? f.scores.list() : f.matches.list()).length, 1);
      assert.deepEqual(f.workspace.workbench.inspect(page), again);
      db.exec('DROP TRIGGER fail_selection;');
      if (page === 'score') f.scores.save({ ...f.scores.list()[0], id: 'new-record' });
      else f.matches.save({ ...f.matches.list()[0], id: 'new-record' });
      assert.equal(f.workspace.workbench.inspect(page).currentId, 'new-record');
      assert.equal(f.workspace.workbench.inspect(page).canUndo, false);
      assert.equal((page === 'score' ? f.scores.list() : f.matches.list())[1].id, record.id);
    } finally {
      db.close();
      f.close();
    }
  });
  test(`${page}: pending run rejects clear/select; stale confirmed sends cannot repopulate cleared results`, async () => {
    const f = fixture();
    const mock = await nativeFixture();
    try {
      const p = f.ai.registry.saveProvider({
        name: 'local',
        baseUrl: mock.baseUrl('anthropic'),
        protocol: 'anthropic',
        apiKey: 'FAKE-KEY',
      });
      const m = f.ai.registry.saveModel({
        providerId: p.id,
        name: 'fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      f.ai.registry.select(page, m.id, {}, f.ai.registry.catalog().pages[page].revision);
      const before = f.workspace.workbench.inspect(page);
      const prepared =
        page === 'score' ? f.service.prepareScore(false) : f.service.prepareMatch(false);
      f.service.changeWorkbench('clear', before);
      await assert.rejects(
        page === 'score'
          ? f.service.score(prepared as ReturnType<typeof f.service.prepareScore>)
          : f.service.match(prepared as ReturnType<typeof f.service.prepareMatch>),
        /变化/,
      );
      assert.equal(mock.requests.length, 0);
      f.service.changeWorkbench('undo', f.workspace.workbench.inspect(page));
      const current = f.workspace.workbench.inspect(page);
      mock.setMode('slow');
      const run =
        page === 'score'
          ? f.service.score(f.service.prepareScore(false))
          : f.service.match(f.service.prepareMatch(false));
      const cancelled = assert.rejects(run, /取消/);
      for (let i = 0; i < 100 && !mock.requests.length; i++) await delay(10);
      assert.equal(mock.requests.length, 1, 'real localhost request is pending');
      assert.throws(() => f.service.changeWorkbench('clear', current), /运行/);
      assert.throws(
        () => f.service.selectAssessment(page, current.currentId!, current.revision),
        /运行/,
      );
      f.service.cancelAll();
      await cancelled;
      assert.deepEqual(f.workspace.workbench.inspect(page), current);
      assert.equal(f.service.changeWorkbench('clear', current).hasResult, false);
    } finally {
      f.close();
      await mock.close();
    }
  });
}

for (const page of ['resume', 'letter'] as const) {
  test(`${page}: active generation blocks clearing; old confirmation stays stale after clear and undo`, async () => {
    const f = fixture();
    const mock = await nativeFixture();
    try {
      const p = f.ai.registry.saveProvider({
        name: 'local',
        baseUrl: mock.baseUrl('anthropic'),
        protocol: 'anthropic',
        apiKey: 'FAKE-KEY',
      });
      const m = f.ai.registry.saveModel({
        providerId: p.id,
        name: 'fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      f.ai.registry.select(page, m.id, {}, f.ai.registry.catalog().pages[page].revision);
      const before = f.workspace.workbench.inspect(page);
      const request = {
        page,
        runId: randomUUID(),
        revision: f.ai.registry.credentials(page).connection.revision,
        workbenchRevision: before.revision,
        input: before.draft,
      };
      f.service.changeWorkbench('clear', before);
      f.service.changeWorkbench('undo', f.workspace.workbench.inspect(page));
      await assert.rejects(
        f.service.generate(request, () => {}),
        /结果已变化/,
      );
      assert.equal(mock.requests.length, 0);
      const current = f.workspace.workbench.inspect(page);
      mock.setMode('slow');
      const run = f.service.generate(
        { ...request, runId: randomUUID(), workbenchRevision: current.revision },
        () => {},
      );
      const cancelled = assert.rejects(run, /取消/);
      for (let i = 0; i < 100 && !mock.requests.length; i++) await delay(10);
      assert.equal(mock.requests.length, 1);
      assert.throws(() => f.service.changeWorkbench('clear', current), /运行/);
      f.service.cancelAll();
      await cancelled;
      assert.equal(f.ai.listVersions(page).length, 1);
      assert.deepEqual(f.workspace.workbench.inspect(page), current);
      assert.equal(f.service.changeWorkbench('clear', current).hasResult, false);
    } finally {
      f.close();
      await mock.close();
    }
  });
}
test('undo cannot resurrect a trashed writing version; invalid pages and stale selections fail closed', () => {
  const f = fixture();
  try {
    const state = f.workspace.workbench.inspect('resume');
    f.service.changeWorkbench('clear', state);
    const version = f.ai.listVersions('resume')[0];
    f.ai.deleteVersions('resume', [version], f.workspace.readWorkspace('resume'));
    assert.throws(
      () => f.service.changeWorkbench('undo', f.workspace.workbench.inspect('resume')),
      /回收站/,
    );
    assert.equal(f.workspace.workbench.inspect('resume').canUndo, true);
    f.ai.recoverVersions('resume', [version]);
    assert.equal(
      f.service.changeWorkbench('undo', f.workspace.workbench.inspect('resume')).hasResult,
      true,
    );
    for (const page of ['__proto__', '../score', 'score_records;DROP TABLE drafts'])
      assert.throws(() => f.workspace.workbench.inspect(page as 'resume'), /Invalid workspace/);
    assert.throws(
      () =>
        f.service.selectAssessment(
          'resume' as 'score',
          'o4-score-record',
          f.workspace.workbench.inspect('resume').revision,
        ),
      /无效/,
    );
    const match = f.workspace.workbench.inspect('match');
    assert.throws(
      () => f.service.selectAssessment('match', "' OR 1=1--", match.revision),
      /找不到/,
    );
    assert.deepEqual(f.workspace.workbench.inspect('match'), match);
  } finally {
    f.close();
  }
});
