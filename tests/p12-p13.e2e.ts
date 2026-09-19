import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MaterialStore } from '../electron/material-store';
import { responsesFixture } from './responses-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
async function launch(dir: string) {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
    env,
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return { app, page };
}
const pages = [
  ['resume', '设计简历'],
  ['score', '简历评分'],
  ['match', '岗位匹配'],
  ['letter', '撰写求职信'],
] as const;
test('P13 four prompt libraries edit/save/load/reset independently and survive restart without network', async ({}, info) => {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/p13-prompts-'));
  let { app, page } = await launch(dir);
  try {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    for (const [id, label] of pages) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.system-prompt > summary').click();
      await page.getByLabel('系统提示词正文', { exact: true }).fill('CUSTOM-' + id);
      await page.getByLabel('提示词副本名称', { exact: true }).fill('Variant ' + id);
      await page.getByRole('button', { name: '另存为本页提示词', exact: true }).click();
      await expect(page.getByLabel('本页提示词副本')).toContainText('已另存本页副本');
      await page.getByRole('button', { name: '恢复默认提示词', exact: true }).click();
      await page.getByRole('button', { name: '确认恢复默认', exact: true }).click();
      await expect(page.getByLabel('系统提示词正文', { exact: true })).not.toHaveValue(
        'CUSTOM-' + id,
      );
      await page
        .getByLabel('已保存提示词', { exact: true })
        .selectOption({ label: 'Variant ' + id });
      await page.getByRole('button', { name: '加载所选提示词', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: '确认加载提示词' })).toBeVisible();
      await page.getByRole('button', { name: '取消加载', exact: true }).click();
      await expect(page.getByLabel('系统提示词正文', { exact: true })).not.toHaveValue(
        'CUSTOM-' + id,
      );
      await page.getByRole('button', { name: '加载所选提示词', exact: true }).click();
      await page.getByRole('button', { name: '确认加载提示词', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            async (id) => (await window.career!.load()).workspaces[id].systemPrompt,
            id,
          ),
        )
        .toBe('CUSTOM-' + id);
      expect(await page.getByLabel('已保存提示词', { exact: true }).locator('option').count()).toBe(
        2,
      );
    }
    expect(requests).toEqual([]);
    await captureWindow(app, info.outputPath('prompt-library.png'));
    await app.close();
    ({ app, page } = await launch(dir));
    for (const [id, label] of pages) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.system-prompt > summary').click();
      await expect(page.getByLabel('系统提示词正文', { exact: true })).toHaveValue('CUSTOM-' + id);
      await expect(page.getByLabel('已保存提示词', { exact: true }).locator('option')).toHaveCount(
        2,
      );
    }
  } finally {
    await app.close();
  }
});
test('P12 two-page provenance, blocked link batch, local fallback and mandatory per-run job review persist', async ({}, info) => {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/p12-web-'));
  const materials = new MaterialStore(join(dir, 'workspace.sqlite'));
  for (const id of ['match', 'letter'] as const) {
    for (const [path, title] of [
      ['a', 'Engineer A'],
      ['b', 'Engineer B'],
    ])
      materials.importWeb(id, 'job', {
        url: 'https://jobs.example.com/' + path,
        retrievedUrl: 'https://jobs.example.com/read/' + path,
        title,
        text: 'Python services required. This is a fictional job snapshot for offline tests.',
        warnings: ['Synthetic preseed, not a live website test'],
      });
  }
  materials.close();
  let answer = '';
  const mock = await responsesFixture(() => answer);
  let { app, page } = await launch(dir);
  try {
    await page.evaluate(async (baseUrl) => {
      const api = window.career!;
      const p = await api.ai.registry.saveProvider({
        name: 'P12 local',
        baseUrl,
        apiKey: 'FAKE-P12',
        protocol: 'chat-completions',
      });
      if (!p.ok) throw Error('provider');
      const m = await api.ai.registry.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'P12 model',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'supported' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw Error('model');
      for (const id of ['match', 'letter'] as const) {
        const c = await api.ai.registry.catalog();
        await api.ai.registry.selectModel(id, m.catalog.models[0].id, {}, c.pages[id].revision);
      }
    }, mock.baseUrl);
    await page.reload();
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 网页 · Engineer A', exact: true }),
    ).not.toBeChecked();
    await expect(page.getByRole('region', { name: '本页附件资料', exact: true })).toContainText(
      '实际读取来源',
    );
    await page
      .getByLabel('网页链接草稿')
      .fill('https://127.0.0.1/\nhttps://10.0.0.1/\nfile:///not-allowed');
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    await page.getByRole('button', { name: '确认访问并读取', exact: true }).click();
    await expect(page.locator('.web-read-result')).toHaveCount(3);
    await expect(page.locator('.web-read-result').filter({ hasText: '读取失败' })).toHaveCount(3);
    expect(mock.requests).toHaveLength(0);
    await page.locator('.web-paste-fallback > summary').click();
    await page.getByLabel('网页资料用途', { exact: true }).selectOption('evidence');
    await page.getByLabel('补充资料标题', { exact: true }).fill('Portfolio');
    await page
      .getByLabel('补充资料来源', { exact: true })
      .fill('https://portfolio.example.com/work?tracking=1');
    await page.getByLabel('补充资料正文', { exact: true }).fill('MATCH ONLY portfolio evidence');
    await page.getByRole('button', { name: '保存本地补充（不联网）', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Portfolio', exact: true }),
    ).not.toBeChecked();
    await expect(
      page.locator('.material-item').filter({ hasText: '本地补充 · Portfolio' }),
    ).toContainText('未访问/核验网页');
    await page
      .getByRole('checkbox', { name: '发送资料 本地补充 · Portfolio', exact: true })
      .check();
    for (const title of ['Engineer A', 'Engineer B'])
      await page.getByRole('checkbox', { name: '发送资料 网页 · ' + title, exact: true }).check();
    await page.getByLabel('匹配使用的简历正文').fill('I built Python services.');
    const job = await page.evaluate(async () =>
      (await window.career!.materials.list('match')).find((i) => i.sourceTitle === 'Engineer A')!,
    );
    answer = JSON.stringify({
      requirements: [
        {
          id: 'r1',
          requirement: 'Python',
          hard: false,
          status: 'met',
          jobEvidence: [{ sourceId: job.id + ':p1', quote: 'Python services required' }],
          evidence: [{ sourceId: 'resume', quote: 'Python services' }],
          note: 'Same target verified by user',
        },
      ],
      summary: 'P12 MATCH',
      recommendation: 'apply',
      reasons: [],
      warnings: [],
    });
    await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认发送并匹配', exact: true })).toBeDisabled();
    expect(mock.requests).toHaveLength(0);
    await page
      .getByRole('checkbox', { name: '我已核对以上资料属于同一目标岗位，已排除冲突内容' })
      .check();
    await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
    await expect(page.locator('.match-summary')).toContainText('P12 MATCH');
    await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认发送并匹配', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '返回修改', exact: true }).click();
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Portfolio', exact: true }),
    ).toHaveCount(0);
    for (const title of ['Engineer A', 'Engineer B'])
      await page.getByRole('checkbox', { name: '发送资料 网页 · ' + title, exact: true }).check();
    await page.getByLabel('求职信使用的简历正文').fill('LETTER ONLY Python experience');
    answer = JSON.stringify({
      document: 'P12 LETTER',
      suggestions: 'confirmed sources',
      rationale: 'local fixture',
    });
    await page.getByRole('button', { name: '生成求职信', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认发送并生成', exact: true })).toBeDisabled();
    await page
      .getByRole('checkbox', { name: '我已核对以上资料属于同一目标岗位，已排除冲突内容' })
      .check();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    expect(mock.requests).toHaveLength(2);
    expect(JSON.stringify(mock.requests[1].body)).not.toContain('MATCH ONLY');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(860, 950));
    await page.evaluate(async () => {
      const s = await window.career!.load();
      await window.career!.savePreferences({ ...s.preferences, theme: 'dark' });
    });
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await captureWindow(app, info.outputPath('p12-sources-dark.png'));
    await app.close();
    ({ app, page } = await launch(dir));
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await expect(page.locator('.match-summary')).toContainText('P12 MATCH');
    await expect(
      page.getByRole('checkbox', { name: '发送资料 本地补充 · Portfolio', exact: true }),
    ).toBeChecked();
    const saved = await page.evaluate(() => window.career!.materials.list('match'));
    expect(saved.find((i) => i.sourceKind === 'pasted')?.sourceUrl).toBe(
      'https://portfolio.example.com/work',
    );
  } finally {
    await app.close();
    await mock.close();
  }
});

test('P13 unique attachment region survives startup, rerenders and tab changes', async () => {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/p13-single-ui-'));
  const { app, page } = await launch(dir);
  try {
    for (const [, label] of pages) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('#user-prompt').fill('Rerender key regression');
      await expect(page.getByRole('region', { name: '本页附件资料', exact: true })).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }),
      ).toHaveCount(1);
      await page.getByLabel('资料用途', { exact: true }).selectOption('evidence');
      await page.locator('.system-prompt > summary').click();
      await page.getByLabel('提示词副本名称', { exact: true }).fill('another rerender');
      await expect(page.getByRole('region', { name: '本页附件资料', exact: true })).toHaveCount(1);
    }
  } finally {
    await app.close();
  }
});
