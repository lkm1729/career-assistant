import { test, expect, type Page, type Locator } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { launch } from './o7-web-fixture';
import { seedO10 } from './o10-fixture';
import { captureWindow } from './capture-window';
import { fixture as streamFixture, activate } from './o6-performance-fixture';

async function history(page: Page) {
  await page.getByRole('button', { name: '查看保留的历史', exact: true }).click();
  return page.getByRole('dialog');
}
async function deleteSelection(dialog: Locator, label: string) {
  await dialog.getByRole('button', { name: new RegExp(`^永久删除所选${label}`) }).click();
  return dialog.getByRole('region', { name: `确认删除${label}`, exact: true });
}
for (const [id, name] of [
  ['resume', '设计简历'],
  ['letter', '撰写求职信'],
] as const)
  test(`O10 ${id}: trash/drafts across pages, cancel, preserve other scopes and restart`, async ({}, info) => {
    const { dir } = seedO10();
    let { app, page } = await launch(dir);
    try {
      await page.getByRole('button', { name, exact: true }).click();
      const before = await page.evaluate(() => window.career!.load());
      const opposite: 'resume' | 'letter' = id === 'resume' ? 'letter' : 'resume';
      const other = await page.evaluate(
        (p: 'resume' | 'letter') => window.career!.ai.getHistory(p),
        opposite,
      );
      let dialog = await history(page);
      await dialog.getByRole('button', { name: '回收站 (25)', exact: true }).click();
      await expect(dialog.locator('.history-select-row')).toHaveCount(20);
      await dialog.getByRole('checkbox', { name: '选择回收站版本 第1条', exact: true }).check();
      await dialog.getByRole('button', { name: '回收站版本分页下一页', exact: true }).click();
      await dialog.getByRole('checkbox', { name: '选择回收站版本 第21条', exact: true }).check();
      await expect(dialog.getByRole('group', { name: '批量管理回收站版本' })).toContainText(
        '已选 2 / 25 条',
      );
      let confirmation = await deleteSelection(dialog, '回收站版本');
      await expect(confirmation).toContainText('永久删除 2 条');
      await confirmation.getByRole('button', { name: '取消删除', exact: true }).click();
      expect(
        (await page.evaluate((p) => window.career!.ai.getHistory(p), id)).deleted,
      ).toHaveLength(25);
      await dialog.getByRole('button', { name: '取消选择', exact: true }).click();
      await dialog.getByRole('checkbox', { name: '全选可操作版本', exact: true }).check();
      confirmation = await deleteSelection(dialog, '回收站版本');
      await expect(confirmation).toContainText('永久删除 25 条');
      await expect(confirmation).toContainText('含跨分页选中项');
      await confirmation.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await captureWindow(app, info.outputPath(`${id}-trash-light.png`));
      await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(dialog.getByText('本页没有回收站版本。', { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('checkbox', { name: '全选可操作版本', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('button', { name: '切换前草稿 (25)', exact: true }).click();
      await dialog.locator('.history-select-row > button').first().click();
      await expect(dialog.getByRole('region', { name: '恢复草稿备份', exact: true })).toBeVisible();
      await dialog.getByRole('checkbox', { name: '全选草稿备份', exact: true }).check();
      confirmation = await deleteSelection(dialog, '草稿备份');
      await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(dialog.getByText('本页没有草稿备份。', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('region', { name: '恢复草稿备份', exact: true })).toHaveCount(
        0,
      );
      await dialog.getByRole('button', { name: '返回工作区', exact: true }).click();
      expect((await page.evaluate(() => window.career!.load())).workspaces).toEqual(
        before.workspaces,
      );
      expect(
        await page.evaluate((p: 'resume' | 'letter') => window.career!.ai.getHistory(p), opposite),
      ).toEqual(other);
      await app.close();
      ({ app, page } = await launch(dir));
      await page.getByRole('button', { name, exact: true }).click();
      dialog = await history(page);
      await expect(dialog.getByRole('button', { name: '回收站 (0)', exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: '切换前草稿 (0)', exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: '正文版本 (1)', exact: true })).toBeVisible();
      expect((await page.evaluate(() => window.career!.load())).workspaces[id]).toEqual(
        before.workspaces[id],
      );
    } finally {
      await app.close();
    }
  });
for (const [id, name, label, summary] of [
  ['score', '简历评分', '评估历史', '独立评估历史'],
  ['match', '岗位匹配', '匹配历史', '独立匹配历史'],
] as const)
  test(`O10 ${id}: paginated multi-delete, current/undo retained, inputs and restart`, async ({}, info) => {
    const { dir } = seedO10();
    let { app, page } = await launch(dir);
    try {
      await page.getByRole('button', { name, exact: true }).click();
      const before = await page.evaluate(() => window.career!.load());
      const opposite: 'score' | 'match' = id === 'score' ? 'match' : 'score';
      const other = await page.evaluate(
        async (p: 'score' | 'match') => await window.career![p].history(),
        opposite,
      );
      await page.getByRole('button', { name: '深色', exact: true }).click();
      let dialog = await history(page);
      await dialog.getByText(`${summary} · 25 条`, { exact: true }).click();
      await dialog.getByRole('checkbox', { name: `选择${label} 第1条`, exact: true }).check();
      await dialog.getByRole('button', { name: `${label}分页下一页`, exact: true }).click();
      await dialog.getByRole('checkbox', { name: `选择${label} 第21条`, exact: true }).check();
      let confirmation = await deleteSelection(dialog, label);
      await confirmation.getByRole('button', { name: '取消删除', exact: true }).click();
      expect(
        await page.evaluate(async (p: 'score' | 'match') => await window.career![p].history(), id),
      ).toHaveLength(25);
      confirmation = await deleteSelection(dialog, label);
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setMinimumSize(760, 600);
        w.setSize(800, 900);
      });
      await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
      await confirmation.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await captureWindow(app, info.outputPath(`${id}-delete-dark-narrow.png`));
      await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(dialog.getByText(`${summary} · 23 条`, { exact: true })).toBeVisible();
      expect((await page.evaluate((p) => window.career!.workbench.inspect(p), id)).currentId).toBe(
        `${id}-o10-24`,
      );
      await dialog.locator('.history-select-row > button').first().click();
      await dialog.getByRole('button', { name: '返回工作区', exact: true }).click();
      await page.getByRole('button', { name: '清空当前结果', exact: true }).click();
      await page.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '恢复刚清空的结果', exact: true }),
      ).toBeVisible();
      dialog = await history(page);
      await dialog.getByText(`${summary} · 23 条`, { exact: true }).click();
      await dialog.getByRole('checkbox', { name: `全选${label}`, exact: true }).check();
      confirmation = await deleteSelection(dialog, label);
      await expect(confirmation).toContainText('永久删除 23 条');
      await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(dialog.getByText(`本页没有${label}。`, { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '返回工作区', exact: true }).click();
      await expect(page.getByRole('button', { name: '恢复刚清空的结果', exact: true })).toHaveCount(
        1,
      );
      await expect(page.locator('.result-state')).toHaveText('尚未评估');
      expect((await page.evaluate(() => window.career!.load())).workspaces).toEqual(
        before.workspaces,
      );
      expect(
        await page.evaluate(
          async (p: 'score' | 'match') => await window.career![p].history(),
          opposite,
        ),
      ).toEqual(other);
      await app.close();
      ({ app, page } = await launch(dir));
      expect(
        await page.evaluate(async (p: 'score' | 'match') => await window.career![p].history(), id),
      ).toHaveLength(0);
      expect((await page.evaluate((p) => window.career!.workbench.inspect(p), id)).canUndo).toBe(
        true,
      );
      expect((await page.evaluate(() => window.career!.load())).workspaces).toEqual(
        before.workspaces,
      );
    } finally {
      await app.close();
    }
  });

test('O10 failed/stale confirmations reject atomically and can refresh/reselect', async () => {
  const { dir, path } = seedO10(3);
  const { app, page } = await launch(dir);
  const db = new DatabaseSync(path);
  try {
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    let dialog = await history(page);
    await dialog.getByText('独立评估历史 · 3 条', { exact: true }).click();
    await dialog.getByRole('checkbox', { name: '全选评估历史', exact: true }).check();
    let confirmation = await deleteSelection(dialog, '评估历史');
    // External local state change after confirmation must not be silently accepted.
    await page.evaluate(async () => {
      const api = window.career!;
      const list = await api.score.history();
      const state = await api.workbench.inspect('score');
      await api.workbench.select('score', list[1].id, state.revision);
    });
    await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('操作未确认完成');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(3);
    // Failing the second delete must roll back the entire selected set.
    db.exec(
      "CREATE TRIGGER o10_desktop_failure BEFORE DELETE ON score_records WHEN OLD.id='score-o10-1' BEGIN SELECT RAISE(ABORT,'isolated failure'); END;",
    );
    confirmation = await deleteSelection(dialog, '评估历史');
    await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('操作未确认完成');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(3);
    db.exec('DROP TRIGGER o10_desktop_failure');
    confirmation = await deleteSelection(dialog, '评估历史');
    await confirmation.getByRole('button', { name: '确认永久删除', exact: true }).click();
    await expect(dialog.getByText('本页没有评估历史。', { exact: true })).toBeVisible();
  } finally {
    db.close();
    await app.close();
  }
});

test('O10 all four destructive IPC routes reject during real local streaming', async () => {
  const f = await streamFixture(9);
  try {
    await activate(f.page.getByRole('button', { name: '生成简历', exact: true }));
    await activate(f.page.getByRole('button', { name: '确认发送并生成', exact: true }));
    await expect.poll(() => f.posts).toBe(1);
    const replies = await f.page.evaluate(async () => {
      const a = window.career!;
      return Promise.all([
        a.ai.purgeVersions('resume', []),
        a.ai.deleteDrafts('letter', []),
        a.score.deleteMany([], 'initial'),
        a.match.deleteMany([], 'initial'),
      ]);
    });
    for (const r of replies) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.diagnostic?.code).toBe('AI_BUSY');
    }
    await activate(f.page.getByRole('button', { name: '停止本次生成', exact: true }).first());
    await expect(f.page.getByRole('button', { name: '生成简历', exact: true })).toBeEnabled();
    expect(f.posts).toBe(1);
  } finally {
    await f.close();
  }
});
