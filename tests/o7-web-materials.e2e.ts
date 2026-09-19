import { revealConfirmation } from './confirmation-preview';
import { test, expect } from '@playwright/test';
import { dataDir, launch, offlineWeb, webCalls } from './o7-web-fixture';

test('O7 score webpage batch is consent gated, purpose-specific, opt-in and persists independently', async () => {
  const dir = dataDir();
  let { app, page } = await launch(dir);
  const links =
    'https://portfolio.example.com/project\nhttps://127.0.0.1/blocked\nhttps://portfolio.example.com/job';
  try {
    await offlineWeb(app);
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    const input = page.getByLabel('网页链接草稿', { exact: true });
    await expect(input).toBeVisible();
    await input.fill(links);
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认访问网页' });
    await expect(confirmation.getByLabel('允许公共 DNS 兼容解析（仅本次）')).not.toBeChecked();
    expect(await webCalls(app)).toEqual([]);
    expect(await page.evaluate(() => window.career!.materials.list('score'))).toEqual([]);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    expect(await webCalls(app)).toEqual([]);
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    await page.getByLabel('第1个网页用途', { exact: true }).selectOption('evidence');
    await page.getByLabel('第2个网页用途', { exact: true }).selectOption('resume');
    await page.getByLabel('第3个网页用途', { exact: true }).selectOption('job');
    await confirmation.getByRole('button', { name: '确认访问并读取', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(2);
    await expect(page.getByRole('region', { name: '本次网页读取状态' })).toContainText('读取失败');
    expect(await webCalls(app)).toEqual(['/project', '/job']);
    const items = await page.evaluate(() => window.career!.materials.list('score'));
    expect(items.map((i) => [i.purpose, i.selected, i.workspace])).toEqual([
      ['evidence', false, 'score'],
      ['job', false, 'score'],
    ]);
    expect(
      (await page.evaluate(() => window.career!.materials.manifest('score', false))).items,
    ).toEqual([]);
    await page.getByRole('checkbox', { name: '发送资料 网页 · Fixture /job', exact: true }).check();
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.career!.materials.manifest('score', false))).items.map(
          (i) => i.purpose,
        ),
      )
      .toEqual(['job']);
    const before = await page.evaluate(() => window.career!.materials.manifest('score', false));
    await page.getByLabel('资料用途 网页 · Fixture /job', { exact: true }).selectOption('evidence');
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.career!.materials.manifest('score', false))).revision,
      )
      .not.toBe(before.revision);
    for (const id of ['resume', 'match', 'letter'] as const)
      expect(await page.evaluate((id) => window.career!.materials.list(id), id)).toEqual([]);
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await expect(page.getByLabel('网页链接草稿', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.getByLabel('网页链接草稿', { exact: true })).toHaveValue(links);
    await app.close();
    ({ app, page } = await launch(dir));
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.getByLabel('网页链接草稿', { exact: true })).toHaveValue(links);
    await expect(page.getByLabel('资料用途 网页 · Fixture /job', { exact: true })).toHaveValue(
      'evidence',
    );
    await expect(
      page.getByRole('checkbox', { name: '发送资料 网页 · Fixture /job', exact: true }),
    ).toBeChecked();
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).providers).toEqual([]);
    expect(await page.evaluate(() => window.career!.score.history())).toEqual([]);
  } finally {
    await app.close();
  }
});

test('O7 webpage input and consent action have clear spacing in four workspaces and both themes', async ({}, info) => {
  const { app, page } = await launch(dataDir());
  try {
    const { captureWindow } = await import('./capture-window');
    for (const [width, theme] of [
      [1360, '浅色'],
      [800, '深色'],
    ] as const) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setMinimumSize(760, 600);
        win.setContentSize(width, 940);
      }, width);
      await page.getByRole('button', { name: theme, exact: true }).click();
      for (const name of ['设计简历', '简历评分', '岗位匹配', '撰写求职信']) {
        await page.getByRole('button', { name, exact: true }).click();
        const input = page.getByLabel('网页链接草稿', { exact: true });
        const button = page.getByRole('button', { name: '读取网页前确认', exact: true });
        await input.fill('https://portfolio.example.com/project');
        await button.scrollIntoViewIfNeeded();
        const gap = await button.evaluate((b) => {
          const input = document.querySelector('textarea[aria-label="网页链接草稿"]')!;
          return b.getBoundingClientRect().top - input.getBoundingClientRect().bottom;
        });
        if (name === '简历评分') {
          await button.evaluate((b) => b.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          await captureWindow(app, info.outputPath(`o7-web-${width}-${theme}.png`));
        }
        expect(gap, `${name} ${width}: textarea/action gap`).toBeGreaterThanOrEqual(16);
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await input.focus();
        await page.keyboard.press('Tab');
        await expect(button).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: '确认访问网页' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
      }
    }
  } finally {
    await app.close();
  }
});

test('O7 score local fallback and bulk removal keep send selection, other workspaces and originals independent', async () => {
  const dir = dataDir();
  let { app, page } = await launch(dir);
  try {
    await offlineWeb(app);
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page
      .getByLabel('网页链接草稿', { exact: true })
      .fill('https://portfolio.example.com/project\nhttps://portfolio.example.com/job');
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    await page.getByLabel('第1个网页用途', { exact: true }).selectOption('evidence');
    await page.getByRole('button', { name: '确认访问并读取', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(2);
    await page.getByLabel('网页资料用途', { exact: true }).selectOption('resume');
    await page.getByText('网页读取失败？本地粘贴补充 / 截图说明', { exact: true }).click();
    await page.getByLabel('补充资料标题', { exact: true }).fill('Local CV');
    await page.getByLabel('补充资料正文', { exact: true }).fill('Fictional local resume body');
    await page.getByRole('button', { name: '保存本地补充（不联网）', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(3);
    expect(await webCalls(app)).toEqual(['/project', '/job']);
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Local CV', exact: true }),
    ).not.toBeChecked();
    await page.getByRole('checkbox', { name: '发送资料 本地补充 · Local CV', exact: true }).check();
    const other = await page.evaluate(() =>
      window.career!.materials.importText('resume', 'evidence', {
        title: 'Other page',
        text: 'Other page must survive',
      }),
    );
    expect(other.ok).toBe(true);
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    await page.getByRole('checkbox', { name: '全选待移除资料', exact: true }).check();
    await page
      .getByRole('checkbox', { name: '选择移除 本地补充 · Local CV', exact: true })
      .uncheck();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Local CV', exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 网页 · Fixture /project', exact: true }),
    ).not.toBeChecked();
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: '确认移除资料' });
    await expect(confirm).toContainText('2 项');
    await expect(confirm).not.toContainText('Local CV');
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(3);
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    await confirm.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(1);
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Local CV', exact: true }),
    ).toBeChecked();
    await app.close();
    ({ app, page } = await launch(dir));
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(1);
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    const all = page.getByRole('checkbox', { name: '全选待移除资料', exact: true });
    await all.check();
    await all.uncheck();
    await expect(page.getByRole('button', { name: '移除所选资料', exact: true })).toBeDisabled();
    await all.check();
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(0);
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(1);
    await app.close();
    ({ app, page } = await launch(dir));
    expect(await page.evaluate(() => window.career!.materials.list('score'))).toEqual([]);
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('O7 score job review matches current snapshot, excludes private sources and locks materials while running', async ({}, info) => {
  const { responsesFixture } = await import('./responses-fixture');
  const { captureWindow } = await import('./capture-window');
  const mock = await responsesFixture();
  const { app, page } = await launch(dataDir());
  try {
    await page.evaluate(async (baseUrl) => {
      const api = window.career!;
      const p = await api.ai.registry.saveProvider({
        name: 'O7 fixture',
        baseUrl,
        protocol: 'responses',
        apiKey: 'FAKE-KEY',
      });
      if (!p.ok) throw Error('fixture provider');
      const m = await api.ai.registry.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'Fixture model',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw Error('fixture model');
      const selected = await api.ai.registry.selectModel(
        'score',
        m.catalog.models[0].id,
        {},
        m.catalog.pages.score.revision,
      );
      if (!selected.ok) throw Error('fixture selection');
      for (const [title, purpose, selected] of [
        ['Job one', 'job', true],
        ['Job two', 'job', true],
        ['Personal project', 'evidence', true],
        ['PRIVATE unselected', 'job', false],
      ] as const) {
        const reply = await api.materials.importText('score', purpose, {
          title,
          text: title + ' fictional body',
        });
        if (!reply.ok) throw Error('fixture material');
        const item = reply.items.at(-1)!;
        if (selected) {
          const r = await api.materials.select('score', item.id, item.revision, true);
          if (!r.ok) throw Error('fixture opt in');
        }
      }
    }, mock.baseUrl);
    await page.reload();
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字', { exact: true }).fill('Fictional resume');
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await revealConfirmation(page);
    const dialog = page.getByRole('dialog', { name: '确认本次简历评分' });
    await expect(dialog).toContainText('模式：目标岗位');
    await expect(dialog).not.toContainText('PRIVATE unselected');
    const review = dialog.getByRole('region', { name: '多份岗位来源核对' });
    await expect(review).toContainText('Job one');
    await expect(review).toContainText('Job two');
    await expect(review).not.toContainText('Personal project');
    const send = dialog.getByRole('button', { name: '确认发送并评分', exact: true });
    await expect(send).toBeDisabled();
    await review.getByRole('checkbox').check();
    await expect(send).toBeEnabled();
    await captureWindow(app, info.outputPath('o7-score-job-review.png'));
    expect(mock.requests).toHaveLength(0);
    await page.evaluate(async () => {
      const api = window.career!.materials;
      const item = (await api.list('score')).find((i) => i.name.includes('Job two'))!;
      const r = await api.setPurpose('score', item.id, item.revision, 'evidence');
      if (!r.ok) throw Error('fixture purpose');
    });
    await send.click();
    await expect(
      page.getByText('评分输入或资料在确认后已变化，请重新确认。', { exact: true }).first(),
    ).toBeVisible();
    expect(mock.requests).toHaveLength(0);
    await page.reload();
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await revealConfirmation(page);
    await expect(dialog.getByRole('region', { name: '多份岗位来源核对' })).toHaveCount(0);
    await expect(send).toBeEnabled();
    mock.setMode('slow');
    await send.click();
    await expect.poll(() => mock.requests.length).toBe(1);
    await expect(page.getByLabel('网页链接草稿', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '批量管理', exact: true })).toBeDisabled();
    const replies = await page.evaluate(async () => {
      const api = window.career!.materials;
      const [item] = await api.list('score');
      return [
        await api.setPurpose('score', item.id, item.revision, 'evidence'),
        await api.removeMany('score', [{ id: item.id, revision: item.revision }]),
      ];
    });
    expect(replies.every((r) => !r.ok)).toBe(true);
    expect(JSON.stringify(mock.requests[0].body)).not.toContain('PRIVATE unselected');
    await page.getByRole('button', { name: '取消评分', exact: true }).click();
    await expect(page.getByRole('button', { name: '批量管理', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.career!.score.history())).toEqual([]);
  } finally {
    await app.close();
    await mock.close();
  }
});
