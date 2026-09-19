import { test, expect } from '@playwright/test';
import { o11Fixture, o11Pages } from './o11-fixture';
import { launch } from './o7-web-fixture';
import { fixture as streaming, activate } from './o6-performance-fixture';
import { captureWindow } from './capture-window';
import type { ElectronApplication } from '@playwright/test';
async function captureFresh(app: ElectronApplication, path: string) {
  // Wake the hidden compositor before the final capture, then let the dialog paint.
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
  const page = await app.firstWindow();
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await captureWindow(app, path);
}

for (const [index, [id, name, action]] of o11Pages.entries()) {
  test(`O11 ${id}: compact confirmation, opt-in previews, page connection and cancel`, async ({}, info) => {
    const f = await o11Fixture();
    try {
      await f.page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const badge = f.page.locator('.input-panel > .connection-badge');
      await expect(badge).toContainText(`O11 ${id} Provider / O11 ${id} Model`);
      await expect(badge).toContainText(
        ['OpenAI Chat Completions', 'OpenAI Responses', 'Gemini 原生协议', 'Anthropic Messages'][
          index
        ],
      );
      const before = await f.page.evaluate(() => window.career!.load());
      await f.page.getByRole('button', { name: action, exact: true }).click();
      const dialog = f.page.getByRole('dialog');
      await expect(dialog.getByRole('region', { name: '本次发送摘要' })).toContainText(
        '所选资料 1 项',
      );
      await expect(dialog).toContainText('供应商可能保留日志');
      await expect(dialog.locator('pre')).toHaveCount(0);
      await expect(dialog).not.toContainText('UNSELECTED-SECRET');
      await expect(dialog).not.toContainText('O11-FAKE-KEY');
      await expect(dialog).not.toContainText('http://127.0.0.1:9');
      if (id === 'match') {
        await f.page.evaluate(() => {
          document.documentElement.dataset.theme = 'dark';
        });
        await f.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(800, 850),
        );
      }
      await dialog.evaluate((d) => {
        d.scrollTop = 0;
      });
      await f.page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      await captureFresh(f.app, info.outputPath(`${id}-confirmation.png`));
      await dialog.getByText('查看本次发送内容', { exact: true }).click();
      await expect(dialog).toContainText(`${id} SELECTED`);
      await expect(dialog).not.toContainText('UNSELECTED-SECRET');
      await expect(dialog).not.toContainText('UNSELECTED-PRIVATE-BODY');
      await expect(dialog.locator('pre')).not.toHaveCount(0);
      const previewText = await dialog.locator('.confirmation-details').first().textContent();
      expect(previewText).toContain(`${id} O11 CURRENT-JOB`);
      await dialog.getByText('查看本次发送内容', { exact: true }).click();
      await expect(dialog.locator('pre')).toHaveCount(0);
      await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
      await expect(dialog).toContainText(`${2048 + index}`);
      await expect(dialog).toContainText(`o11-${id}`);
      await expect(dialog).toContainText('http://127.0.0.1:9');
      if (id === 'score') await expect(dialog).toContainText('store: false');
      await dialog.getByRole('button', { name: '返回修改', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const after = await f.page.evaluate(() => window.career!.load());
      expect(after.workspaces).toEqual(before.workspaces);
      // Models changed via real UI: only this page changes and unconfigured is explicit.
      await f.page.getByRole('combobox', { name: '本页模型' }).selectOption('');
      await expect(badge).toContainText('尚未选择模型');
      await expect(f.page.getByRole('button', { name: action, exact: true })).toBeDisabled();
    } finally {
      await f.app.close();
    }
  });
}

test('O11 score/match history uses saved timestamp and model across selection and restart', async ({}, info) => {
  const f = await o11Fixture();
  let app = f.app,
    page = f.page;
  const values: Record<string, string> = {};
  try {
    for (const [id, name] of o11Pages.filter((p) => p[0] === 'score' || p[0] === 'match')) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const metadata = page.getByRole('group', { name: '当次评估信息' });
      await expect(metadata).toContainText('fixture / fixture');
      await expect(metadata).not.toContainText('O11');
      const iso = await metadata.locator('time').getAttribute('datetime');
      expect(iso).toBe(id === 'score' ? '2026-09-18T00:00:00.000Z' : '2026-09-17T00:00:00.000Z');
      values[id] = (await metadata.textContent())!;
      const options = await page
        .getByRole('combobox', { name: '本页模型' })
        .locator('option')
        .allTextContents();
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: options.find((o) => o.includes('O11 resume Model'))! });
      await expect(page.locator('.input-panel > .connection-badge')).toContainText(
        'O11 resume Provider',
      );
      await expect(metadata).toHaveText(values[id]);
      await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
      await captureFresh(app, info.outputPath(`${id}-timestamp.png`));
    }
    await app.close();
    ({ app, page } = await launch(f.dir));
    for (const [id, name] of o11Pages.filter((p) => p[0] === 'score' || p[0] === 'match')) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('group', { name: '当次评估信息' })).toHaveText(values[id]);
    }
  } finally {
    await app.close();
  }
});

test('O11 all four live requests show their own frozen connection while other pages stay independent', async () => {
  const f = await streaming(9);
  try {
    for (const [id, name, action, confirm] of o11Pages) {
      await f.page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await activate(f.page.getByRole('button', { name: action, exact: true }));
      await f.page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
      const badge = f.page.locator('.input-panel > .connection-badge');
      await expect(badge).toContainText('本次运行使用');
      await expect(badge).toContainText('Perf 0 / Perf Model 0');
      await expect.poll(() => f.posts).toBe(o11Pages.findIndex((p) => p[0] === id) + 1);
      const other = id === 'letter' ? '设计简历' : '撰写求职信';
      await f.page
        .getByRole('navigation')
        .getByRole('button', { name: other, exact: true })
        .click();
      await expect(f.page.locator('.input-panel > .connection-badge')).toContainText('下次使用');
      await f.page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await expect(badge).toContainText('本次运行使用');
      const cancel = id === 'score' ? '取消评分' : id === 'match' ? '取消匹配' : '取消生成';
      await activate(f.page.getByRole('button', { name: cancel, exact: true }).first());
      await expect(badge).toContainText('下次使用');
    }
  } finally {
    await f.close();
  }
});

test('O11 long model, multi-job consent and opt-in local diagnostics survive detail toggles', async ({}, info) => {
  const f = await o11Fixture();
  try {
    const longName = '长模型名称-Version-'.repeat(5);
    await f.page.evaluate(async (name) => {
      const api = window.career!;
      const c = await api.ai.registry.catalog();
      const m = c.models.find((m) => m.modelId === 'o11-match')!;
      const reply = await api.ai.registry.saveModel({ ...m, name });
      if (!reply.ok) throw Error(reply.message);
      const r = await api.materials.importText('match', 'job', {
        title: 'SECOND JOB',
        text: 'Another description of the target job.',
      });
      if (!r.ok) throw Error(r.diagnostic.message);
      const item = r.items.find((i) => i.name.includes('SECOND JOB'))!;
      const selected = await api.materials.select('match', item.id, item.revision, true);
      if (!selected.ok) throw Error(selected.diagnostic.message);
      const snapshot = await api.load();
      await api.saveWorkspace('match', {
        ...snapshot.workspaces.match,
        document: 'O11-LONG-RESUME '.repeat(10000),
      });
    }, longName);
    await f.page.reload();
    await f.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setMinimumSize(760, 600);
      w.setSize(800, 900);
    });
    await f.page
      .getByRole('navigation')
      .getByRole('button', { name: '岗位匹配', exact: true })
      .click();
    await expect(f.page.locator('.input-panel > .connection-badge')).toContainText(longName);
    await f.page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    const dialog = f.page.getByRole('dialog');
    const send = dialog.getByRole('button', { name: '确认发送并匹配', exact: true });
    await expect(send).toBeDisabled();
    await expect(dialog.getByRole('region', { name: '多份岗位来源核对' })).toBeVisible();
    expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
    await expect(dialog.locator('pre')).toHaveCount(0);
    const collapsed = await dialog.locator('*').count();
    await dialog.getByText('查看本次发送内容', { exact: true }).click();
    await expect(dialog).toContainText('O11-LONG-RESUME');
    const expanded = await dialog.locator('*').count();
    expect(expanded).toBeGreaterThan(collapsed);
    await dialog.getByText('查看本次发送内容', { exact: true }).click();
    await expect(dialog.locator('pre')).toHaveCount(0);
    await dialog
      .getByRole('checkbox', {
        name: '我已核对以上资料属于同一目标岗位，已排除冲突内容',
        exact: true,
      })
      .check();
    await expect(send).toBeEnabled();
    await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
    const retain = dialog.getByRole('checkbox', {
      name: '仅本次JSON失败时保留响应供本机临时查看',
      exact: true,
    });
    await expect(retain).not.toBeChecked();
    await retain.check();
    await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
    await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
    await expect(retain).toBeChecked();
    await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
    await captureFresh(f.app, info.outputPath('long-model-consent.png'));
    await info.attach('lazy-preview-nodes.json', {
      body: JSON.stringify({ collapsed, expanded }),
      contentType: 'application/json',
    });
    await f.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await f.page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    await expect(send).toBeDisabled();
    await dialog.getByText('连接、参数与处理说明', { exact: true }).click();
    await expect(retain).not.toBeChecked();
    await dialog.getByRole('button', { name: '返回修改', exact: true }).click();
  } finally {
    await f.app.close();
  }
});

test('O11 selecting an older history changes only its saved metadata, including after restart', async () => {
  const { seedO4, o4Stores } = await import('./o4-fixture');
  const { dataDir } = await import('./o7-web-fixture');
  const { join } = await import('node:path');
  const dir = dataDir();
  const path = join(dir, 'workspace.sqlite');
  seedO4(path);
  const stores = o4Stores(path);
  try {
    const s = stores.scores.list()[0],
      m = stores.matches.list()[0];
    stores.scores.save({
      ...s,
      id: 'o11-new-score',
      createdAt: '2026-09-19T01:02:03Z',
      connection: { ...s.connection, providerName: 'New snapshot', modelName: 'New score model' },
    });
    stores.matches.save({
      ...m,
      id: 'o11-new-match',
      createdAt: '2026-09-19T01:02:03Z',
      connection: { ...m.connection, providerName: 'New snapshot', modelName: 'New match model' },
    });
  } finally {
    stores.close();
  }
  let { app, page } = await launch(dir);
  try {
    for (const [id, name] of o11Pages.filter((p) => p[0] === 'score' || p[0] === 'match')) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const meta = page.getByRole('group', { name: '当次评估信息' });
      await expect(meta).toContainText(`New ${id} model`);
      await page.locator('.evaluation-panel .score-history > summary').click();
      await page.locator('.evaluation-panel .history-select-row > button').nth(1).click();
      await expect(meta).toContainText('fixture / fixture');
      await expect(meta.locator('time')).toHaveAttribute(
        'datetime',
        id === 'score' ? '2026-09-18T00:00:00.000Z' : '2026-09-17T00:00:00.000Z',
      );
    }
    await app.close();
    ({ app, page } = await launch(dir));
    for (const [, name] of o11Pages.filter((p) => p[0] === 'score' || p[0] === 'match')) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('group', { name: '当次评估信息' })).toContainText(
        'fixture / fixture',
      );
    }
  } finally {
    await app.close();
  }
});
