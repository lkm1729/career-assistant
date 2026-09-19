import { test, expect } from '@playwright/test';
import { scoreDesktop } from './o8-desktop-fixture';

test('O8 confirmation explains absent images before billing; partial text result has specific reasons', async () => {
  const f = await scoreDesktop();
  try {
    await f.page.getByLabel('评分简历文字', { exact: true }).fill('Fictional resume');
    const dialog = await f.prepare();
    await expect(dialog.getByRole('region', { name: '评分前完整性检查' })).toContainText(
      '原始简历页面图像',
    );
    expect(f.mock.requests).toHaveLength(0);
    await dialog.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    const coverage = f.page.getByRole('region', { name: '评分完整性' });
    await expect(coverage).toContainText('本次只有简历文字');
    await expect(f.page.locator('.evaluation-panel .score-number').first()).toContainText('—');
    expect(f.mock.requests).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('O8 complete PDF scores despite unselected evidence, keeps privacy and survives restart', async ({}, info) => {
  const f = await scoreDesktop();
  try {
    await f.importResume();
    const dialog = await f.prepare();
    const input = dialog.getByRole('region', { name: '评分前完整性检查' });
    await expect(input).toContainText('本机解析 2/2 页');
    await expect(input).toContainText('本机页面准备完整');
    await expect(dialog).not.toContainText('PRIVATE-unselected');
    expect(f.mock.requests).toHaveLength(0);
    await dialog.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    const coverage = f.page.getByRole('region', { name: '评分完整性' });
    await expect(coverage).toContainText('完整评价条件已满足');
    await expect(coverage).toContainText('模型确认看清 2 页');
    await expect(f.page.locator('.evaluation-panel .score-number').first()).toContainText('80');
    expect(f.mock.requests).toHaveLength(1);
    expect(JSON.stringify(f.mock.requests[0].body)).not.toContain('PRIVATE-NOT-SENT');
    expect(JSON.stringify(f.mock.requests[0].body)).not.toContain('PRIVATE-unselected');
    const records = await f.page.evaluate(() => window.career!.score.history());
    expect(records).toHaveLength(1);
    expect(records[0].completeness?.reasons).toEqual([]);
    const { captureWindow } = await import('./capture-window');
    await coverage.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await f.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await captureWindow(f.app, info.outputPath('o8-full-score.png'));
    await f.reopen();
    await expect(f.page.locator('.evaluation-panel .score-number').first()).toContainText('80');
    const reopened = await f.page.evaluate(() => window.career!.score.history());
    expect(reopened).toEqual(records);
    expect(await f.page.evaluate(() => window.career!.materials.list('score'))).toHaveLength(2);
    for (const id of ['resume', 'match', 'letter'] as const)
      expect(await f.page.evaluate((id) => window.career!.materials.list(id), id)).toEqual([]);
  } finally {
    await f.close();
  }
});

test('O8 model omissions, unreadability, incomplete dimensions and conflicts are distinguished without retries', async ({}, info) => {
  const f = await scoreDesktop();
  try {
    await f.importResume();
    let count = 0;
    for (const [mode, reason] of [
      ['omitted', '未被模型列入'],
      ['unreadable', '模型报告 1 页简历图像无法看清'],
      ['dimension', '模型尚未完成这些维度'],
      ['conflict', '尚未核实的内容冲突'],
    ] as const) {
      f.setMode(mode);
      const dialog = await f.prepare();
      await dialog.getByRole('button', { name: '确认发送并评分', exact: true }).click();
      const coverage = f.page.getByRole('region', { name: '评分完整性' });
      await expect(coverage).toContainText(reason);
      await expect(f.page.locator('.evaluation-panel .score-number').first()).toContainText('—');
      expect(f.mock.requests).toHaveLength(++count);
      expect(await f.page.evaluate(() => window.career!.score.history())).toHaveLength(count);
      if (mode === 'omitted') {
        await expect(coverage).toContainText('这不等于原文件残缺');
        await f.page.getByRole('button', { name: '深色', exact: true }).click();
        await f.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(860, 1000),
        );
        await coverage.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await f.page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const { captureWindow } = await import('./capture-window');
        await captureWindow(f.app, info.outputPath('o8-partial-reason-dark.png'));
      }
    }
    f.setMode('invalid');
    const before = await f.page.evaluate(() => window.career!.score.history());
    const dialog = await f.prepare();
    await dialog.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(f.page.getByText('AI_SCORE_EVIDENCE', { exact: true }).first()).toBeVisible();
    expect(await f.page.evaluate(() => window.career!.score.history())).toEqual(before);
    expect(f.mock.requests).toHaveLength(5);
  } finally {
    await f.close();
  }
});

test('O8 disabling images is explained before send and old partial records are never silently rescored', async () => {
  const f = await scoreDesktop();
  try {
    await f.importResume(1);
    await f.page.getByLabel('本次发送页面图像', { exact: false }).uncheck();
    const dialog = await f.prepare();
    await expect(dialog.getByRole('region', { name: '评分前完整性检查' })).toContainText(
      '关闭了页面图像发送',
    );
    await dialog.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(f.page.getByRole('region', { name: '评分完整性' })).toContainText(
      '未发送可用于视觉评价',
    );
    const [record] = await f.page.evaluate(() => window.career!.score.history());
    expect(record.total).toBeNull();
    expect(JSON.stringify(f.mock.requests[0].body)).not.toContain('input_image');
    const { ScoreStore } = await import('../electron/scoring');
    const { join } = await import('node:path');
    await f.reopen(() => {
      const store = new ScoreStore(join(f.dir, 'workspace.sqlite'));
      try {
        store.save({
          ...record,
          id: 'o8-legacy-partial-record',
          completeness: undefined,
          warnings: [
            '图像或页面覆盖不完整、质量不足或存在冲突：仅显示部分评价，不计算完整总分，不重分配权重。',
          ],
        });
      } finally {
        store.close();
      }
    });
    await expect(f.page.getByRole('region', { name: '评分完整性' })).toContainText('不会自动重算');
    await expect(f.page.locator('.evaluation-panel .score-number').first()).toContainText('—');
    expect(await f.page.evaluate(() => window.career!.score.history())).toHaveLength(2);
    expect(f.mock.requests).toHaveLength(1);
  } finally {
    await f.close();
  }
});
