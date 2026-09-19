import { test, expect, type Page } from '@playwright/test';
import { launch, dataDir } from './o7-web-fixture';
import { seedO10 } from './o10-fixture';
import { o4Stores } from './o4-fixture';
import { captureWindow } from './capture-window';

async function transfer(page: Page, type: 'drop' | 'paste', name: string, text: string) {
  await page.locator('.material-dropzone').evaluate(
    (element, args) => {
      const data = new DataTransfer();
      data.items.add(new File([args.text], args.name, { type: 'text/plain' }));
      element.dispatchEvent(
        args.type === 'drop'
          ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
          : new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      );
    },
    { type, name, text },
  );
}
for (const [id, name] of [
  ['resume', '设计简历'],
  ['score', '简历评分'],
  ['match', '岗位匹配'],
  ['letter', '撰写求职信'],
] as const) {
  test(`O12/O13 ${id}: distinct entries, drop/paste confirm, cancel, validation and isolation`, async ({}, info) => {
    const dir = dataDir();
    let { app, page } = await launch(dir);
    try {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await expect(page.getByText('添加参考网页链接', { exact: false }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /添加参考文件/ })).toBeVisible();
      await expect(
        page
          .getByLabel('资料用途', { exact: true })
          .getByRole('option', { name: '补充材料', exact: true }),
      ).toHaveCount(1);
      const box = page.locator('.material-entry-files');
      const web = page.locator('.material-entry-web');
      const bounds = await web.boundingBox();
      const fileBounds = await box.boundingBox();
      expect(fileBounds!.y - (bounds!.y + bounds!.height)).toBeGreaterThanOrEqual(18);
      await transfer(page, 'drop', 'drop.txt', 'LOCAL DROP BODY');
      await expect(page.getByRole('region', { name: '逐项设置文件用途' })).toContainText(
        'drop.txt',
      );
      expect(await page.evaluate((p) => window.career!.materials.list(p), id)).toHaveLength(0);
      await page.getByLabel('第1个文件用途', { exact: true }).selectOption('evidence');
      await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: '发送资料 drop.txt', exact: true }),
      ).not.toBeChecked();
      await expect(page.getByLabel('资料用途 drop.txt', { exact: true })).toHaveValue('evidence');
      await transfer(page, 'paste', 'paste.txt', 'LOCAL PASTE BODY');
      await expect(page.getByRole('region', { name: '逐项设置文件用途' })).toContainText(
        'paste.txt',
      );
      await page.getByRole('button', { name: '取消本次文件导入', exact: true }).click();
      expect(await page.evaluate((p) => window.career!.materials.list(p), id)).toHaveLength(1);
      await transfer(page, 'paste', 'paste.txt', 'LOCAL PASTE BODY');
      await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: '发送资料 paste.txt', exact: true }),
      ).not.toBeChecked();
      await transfer(page, 'drop', 'unsafe.exe', 'no execution');
      await expect(page.locator('.material-local-feedback')).toContainText('不支持此文件格式');
      await page.getByRole('button', { name: '深色', exact: true }).click();
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setMinimumSize(760, 600);
        w.setSize(800, 950);
      });
      await box.scrollIntoViewIfNeeded();
      await captureWindow(app, info.outputPath(`${id}-materials-dark.png`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const other of ['resume', 'score', 'match', 'letter'] as const)
        if (other !== id)
          expect(await page.evaluate((p) => window.career!.materials.list(p), other)).toHaveLength(
            0,
          );
      await app.close();
      ({ app, page } = await launch(dir));
      const saved = await page.evaluate((p) => window.career!.materials.list(p), id);
      expect(saved.map((m) => m.name)).toEqual(['drop.txt', 'paste.txt']);
      expect(saved.every((m) => !m.selected)).toBe(true);
    } finally {
      await app.close();
    }
  });
}
for (const [id, name, label] of [
  ['score', '简历评分', '评估历史'],
  ['match', '岗位匹配', '匹配历史'],
] as const) {
  test(`O14 ${id}: delete all history keeps workbench through restart and explicit clear undo`, async ({}, info) => {
    const { dir } = seedO10(3);
    let { app, page } = await launch(dir);
    try {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const before = await page.evaluate((p) => window.career!.workbench.inspect(p), id);
      await page.getByRole('button', { name: '查看保留的历史', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('.assessment-history-toggle').click();
      await expect(dialog.locator('.assessment-history-toggle')).toContainText('展开 / 收起记录');
      await captureWindow(app, info.outputPath(`${id}-history-light.png`));
      await dialog.getByRole('checkbox', { name: `全选${label}`, exact: true }).check();
      await dialog.getByRole('button', { name: new RegExp(`^永久删除所选${label}`) }).click();
      await expect(dialog.getByRole('region', { name: `确认删除${label}` })).toContainText(
        '当前工作台结果',
      );
      await dialog.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(dialog.getByText(`本页没有${label}。`, { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '返回工作区', exact: true }).click();
      await expect(page.locator('.result-state')).not.toHaveText('尚未评估');
      expect(
        (await page.evaluate((p) => window.career!.workbench.inspect(p), id)).assessment,
      ).toEqual(before.assessment);
      await app.close();
      ({ app, page } = await launch(dir));
      await expect(page.locator('.result-state')).not.toHaveText('尚未评估');
      expect(await page.evaluate(async (p) => await window.career![p].history(), id)).toHaveLength(
        0,
      );
      await page.getByRole('button', { name: '清空当前结果', exact: true }).click();
      await page.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
      await expect(page.locator('.result-state')).toHaveText('尚未评估');
      await page.getByRole('button', { name: '恢复刚清空的结果', exact: true }).click();
      await expect(page.locator('.result-state')).not.toHaveText('尚未评估');
      expect(
        (await page.evaluate((p) => window.career!.workbench.inspect(p), id)).assessment,
      ).toEqual(before.assessment);
    } finally {
      await app.close();
    }
  });
}
for (const [id, name] of [
  ['resume', '设计简历'],
  ['letter', '撰写求职信'],
] as const) {
  test(`O14 ${id}: dense labels never change deletion and restoration identity`, async () => {
    const { dir, path } = seedO10(19);
    const f = o4Stores(path);
    try {
      f.ai.recoverVersions(id, f.ai.historyState(id).deleted);
      f.ai.deleteVersions(id, f.ai.listVersions(id).slice(10), f.workspace.readWorkspace(id));
    } finally {
      f.close();
    }
    const { app, page } = await launch(dir);
    try {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await page.getByRole('button', { name: '查看保留的历史', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('checkbox', { name: '选择版本 V10', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('checkbox', { name: '选择版本 V1', exact: true }).check();
      await dialog.getByRole('button', { name: '删除所选版本 (1)', exact: true }).click();
      await dialog.getByRole('button', { name: '确认移入回收站', exact: true }).click();
      await expect(
        dialog.getByRole('checkbox', { name: '选择版本 V9', exact: true }),
      ).toBeDisabled();
      const records = await page.evaluate((p) => window.career!.ai.getHistory(p), id);
      expect(records.versions).toHaveLength(9);
      expect(records.versions[0].number).toBe(20);
      expect(records.versions[0].displayNumber).toBe(9);
      expect(records.deleted.some((v) => v.number === 11)).toBe(true);
    } finally {
      await app.close();
    }
  });
}
