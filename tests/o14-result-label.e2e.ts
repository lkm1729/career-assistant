import { test, expect } from '@playwright/test';
import { seedO10 } from './o10-fixture';
import { launch } from './o7-web-fixture';
import { captureWindow } from './capture-window';

for (const [id, name, generated] of [
  ['resume', '设计简历', 19],
  ['letter', '撰写求职信', 8],
] as const) {
  test(`O14 result label ${id}: current, historical and edited headers use dense numbers, not record IDs`, async ({}, info) => {
    const { dir } = seedO10(generated - 1);
    let { app, page } = await launch(dir);
    try {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const status = () => page.locator('.output-panel .result-state');
      await expect(page.getByLabel('当前正文版本', { exact: true })).toHaveText('正式版本 V1');
      await expect(status()).toHaveText('AI 正式结果 · V1');
      const initial = await page.evaluate((p) => window.career!.ai.getHistory(p), id);
      expect(initial.versions[0].number).toBe(generated);
      expect(initial.versions[0].displayNumber).toBe(1);
      await page
        .locator('.result-heading')
        .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await app.evaluate(async ({ BrowserWindow }) => {
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await captureWindow(app, info.outputPath(`${id}-V1.png`));
      // Keep internal ID 18/7, not 1: historical/edit labels must also prove they are renumbered.
      const older = initial.deleted[0];
      expect(older.number).toBe(generated - 1);
      const recovered = await page.evaluate(
        ({ id, older }) => window.career!.ai.recoverVersions(id, [older]),
        { id, older },
      );
      expect(recovered.ok).toBe(true);
      await page.reload();
      await expect(status()).toHaveText('AI 正式结果 · V2');
      await expect(page.getByLabel('当前正文版本', { exact: true })).toHaveText('正式版本 V2');
      const restore = await page.evaluate(
        async ({ id, number }) => {
          const snapshot = await window.career!.load();
          return window.career!.ai.restoreDocumentVersion(id, number, snapshot.workspaces[id]);
        },
        { id, number: older.number },
      );
      expect(restore.ok).toBe(true);
      await page.reload();
      await expect(status()).toHaveText('历史 AI 结果 · V1');
      await page.evaluate(async (id) => {
        const snapshot = await window.career!.load();
        await window.career!.saveWorkspace(id, {
          ...snapshot.workspaces[id],
          document: 'LOCAL EDITED TEXT',
        });
      }, id);
      await page.reload();
      await expect(status()).toHaveText('手动编辑稿 · 基于 V1');
      await app.close();
      ({ app, page } = await launch(dir));
      await expect(status()).toHaveText('手动编辑稿 · 基于 V1');
      const restoredLatest = await page.evaluate(
        async ({ id, number }) => {
          const snapshot = await window.career!.load();
          return window.career!.ai.restoreDocumentVersion(id, number, snapshot.workspaces[id]);
        },
        { id, number: generated },
      );
      expect(restoredLatest.ok).toBe(true);
      const removed = await page.evaluate(
        async ({ id, older }) => {
          const snapshot = await window.career!.load();
          return window.career!.ai.deleteVersions(id, [older], snapshot.workspaces[id]);
        },
        { id, older },
      );
      expect(removed.ok).toBe(true);
      await page.reload();
      await expect(status()).toHaveText('AI 正式结果 · V1');
      const after = await page.evaluate((p) => window.career!.ai.getHistory(p), id);
      expect(after.versions).toEqual(initial.versions);
      const clear = await page.evaluate(
        async (p) => window.career!.workbench.clear(await window.career!.workbench.inspect(p)),
        id,
      );
      expect(clear.ok).toBe(true);
      await page.reload();
      await expect(status()).toHaveText('等待生成');
      const undo = await page.evaluate(
        async (p) => window.career!.workbench.undo(await window.career!.workbench.inspect(p)),
        id,
      );
      expect(undo.ok).toBe(true);
      await page.reload();
      await expect(status()).toHaveText('AI 正式结果 · V1');
    } finally {
      await app.close();
    }
  });
}
