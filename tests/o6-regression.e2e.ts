import { revealConfirmation } from './confirmation-preview';
import { test, expect } from '@playwright/test';
import { fixture, activate } from './o6-performance-fixture';
import { captureWindow } from './capture-window';

test('O6 model paging/search keeps selection scope, current provider, edits and discovery intact', async ({}, info) => {
  const f = await fixture(60);
  const { page } = f;
  try {
    await activate(page.getByRole('button', { name: '应用设置', exact: true }));
    await expect(page.locator('.model-card')).toHaveCount(25);
    await page.getByLabel('选择模型 Perf Model 0', { exact: true }).check();
    await activate(page.getByRole('button', { name: '已配置模型分页下一页' }));
    await expect(page.locator('.model-card')).toHaveCount(5);
    await page.getByLabel('选择模型 Perf Model 58', { exact: true }).check();
    await expect(
      page.getByRole('button', { name: '删除所选模型（2）', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('搜索本供应商模型').fill('perf-58');
    await expect(page.locator('.model-card')).toHaveCount(1);
    await activate(page.getByRole('button', { name: '编辑模型 Perf Model 58', exact: true }));
    await page.getByLabel('模型显示名称', { exact: true }).fill('Saved model 58');
    await activate(page.getByRole('button', { name: '保存模型', exact: true }));
    await expect(
      page.getByRole('button', { name: '编辑模型 Saved model 58', exact: true }),
    ).toBeAttached();
    await page.getByLabel('全选当前模型').check();
    await activate(page.getByRole('button', { name: '删除所选模型（30）', exact: true }));
    await expect(page.getByRole('region', { name: '删除影响确认' })).toContainText(
      '影响 30 个模型',
    );
    await page
      .getByRole('region', { name: '删除影响确认' })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await activate(page.getByRole('button', { name: '管理 Perf 1', exact: true }));
    await expect(page.getByLabel('搜索本供应商模型')).toHaveValue('');
    await expect(page.locator('.model-card')).toHaveCount(25);
    await expect(
      page.getByRole('button', { name: '删除所选模型（0）', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '编辑模型 Perf Model 1', exact: true }),
    ).toBeAttached();
    await expect(
      page.getByRole('button', { name: '编辑模型 Perf Model 0', exact: true }),
    ).toHaveCount(0);
    const discovery = page.getByRole('region', { name: '获取模型列表', exact: true });
    await discovery.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await discovery.getByRole('button', { name: '确认获取模型列表', exact: true }).click();
    await expect(discovery).toContainText('已获取 60 个');
    await discovery.getByLabel('搜索模型 ID', { exact: true }).fill('discover-59');
    await discovery.getByLabel('全选搜索结果').check();
    await discovery.getByRole('button', { name: '导入所选模型（1）', exact: true }).click();
    await discovery.getByRole('button', { name: '确认导入', exact: true }).click();
    await expect(discovery).toContainText('所选模型已导入');
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).models).toHaveLength(
      61,
    );
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('模型 ID', { exact: true }).fill('new-last-page');
    await page.getByLabel('模型显示名称', { exact: true }).fill('New last page model');
    await page.getByRole('button', { name: '保存并测试模型连通性', exact: true }).click();
    await expect(page.getByRole('region', { name: '测试发送确认' })).toBeVisible();
    await expect(page.getByRole('region', { name: '测试发送确认' })).toContainText('new-last-page');
    await page
      .getByRole('region', { name: '测试发送确认' })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await captureWindow(f.app, info.outputPath('o6-settings.png'));
    expect(f.posts).toBe(0);
  } finally {
    await f.close();
  }
});

test('O6 confirmations use current selected sources; Markdown cache invalidates after edits and clear/undo', async () => {
  const f = await fixture(9);
  const { page } = f;
  try {
    for (const [id, name, button] of [
      ['resume', '设计简历', '生成简历'],
      ['score', '简历评分', '开始评分'],
      ['match', '岗位匹配', '评估匹配度'],
      ['letter', '撰写求职信', '生成求职信'],
    ] as const) {
      await page.evaluate(async (id) => {
        const item = (await window.career!.materials.list(id))[0];
        await window.career!.materials.select(id, item.id, item.revision, true);
      }, id);
      await activate(page.getByRole('button', { name, exact: true }));
      await page.locator('#user-prompt').fill(`${id} latest explicit input`);
      await activate(page.getByRole('button', { name: button, exact: true }));
      await revealConfirmation(page);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`${id} latest explicit input`);
      await expect(dialog).toContainText(`${id}-private-0`);
      await expect(dialog).not.toContainText(`${id}-private-1`);
      await expect(dialog).toContainText(`${id} fictional evidence`);
      for (const other of ['resume', 'score', 'match', 'letter'].filter((p) => p !== id))
        await expect(dialog).not.toContainText(`${other}-private-`);
      await activate(page.getByRole('button', { name: '返回修改', exact: true }));
      await page.evaluate(async (id) => {
        const item = (await window.career!.materials.list(id))[0];
        await window.career!.materials.setPurpose(id, item.id, item.revision, 'resume');
      }, id);
      await activate(page.getByRole('button', { name: button, exact: true }));
      await revealConfirmation(page);
      await expect(
        page.getByRole('dialog').locator('.material-send-preview summary').first(),
      ).toContainText('简历');
      await activate(page.getByRole('button', { name: '返回修改', exact: true }));
    }
    await activate(page.getByRole('button', { name: 'Markdown 编辑', exact: true }));
    await page.getByLabel('正文草稿', { exact: true }).fill('# New content\n\n**Updated**');
    await activate(page.getByRole('button', { name: '阅读预览', exact: true }));
    await expect(page.locator('.markdown-body strong')).toHaveText('Updated');
    await activate(page.getByRole('button', { name: '清空当前结果', exact: true }));
    await activate(page.getByRole('button', { name: '确认清空当前结果', exact: true }));
    await expect(page.locator('.markdown-body')).toHaveText('');
    await activate(page.getByRole('button', { name: '恢复刚清空的结果', exact: true }));
    await expect(page.locator('.markdown-body strong')).toHaveText('Updated');
    expect(f.posts).toBe(0);
  } finally {
    await f.close();
  }
});
