import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { responsesFixture } from './responses-fixture';
const require = createRequire(import.meta.url);
const answer = Array.from(
  { length: 20 },
  (_, i) =>
    `Q${i + 1}. Tell me about your role ${i + 1}?\nQ${i + 1}-ZH. 请介绍第 ${i + 1} 项岗位经历？\nA${i + 1}. I would explain my relevant experience.\nA${i + 1}-ZH. 我会介绍相关经历。`,
).join('\n\n');
test('interview page saves input and displays 20 blue questions and green answers', async () => {
  const mock = await responsesFixture(() => answer);
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/interview-e2e-'));
  const env = { ...process.env, CAREER_TEST_MODE: '1', CAREER_TEST_DATA: dir } as Record<
    string,
    string
  >;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  let app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.evaluate(
      async ({ baseUrl, capabilities, parameters }) => {
        const provider = await window.career!.ai.registry.saveProvider({
          name: 'Local mock',
          baseUrl,
          apiKey: 'FAKE-KEY',
          protocol: 'chat-completions',
        });
        if (!provider.ok) throw new Error(provider.message);
        const p = provider.catalog.providers.find((item) => item.name === 'Local mock')!;
        const model = await window.career!.ai.registry.saveModel({
          providerId: p.id,
          name: 'Fixture',
          modelId: 'fixture',
          protocol: 'inherit',
          capabilities,
          parameterSupport: parameters,
          parameters: {},
        });
        if (!model.ok) throw new Error(model.message);
        const selected = model.catalog.models.find((item) => item.providerId === p.id)!;
        const result = await window.career!.ai.registry.selectModel(
          'interview',
          selected.id,
          {},
          model.catalog.pages.interview.revision,
        );
        if (!result.ok) throw new Error(result.message);
      },
      { baseUrl: mock.baseUrl, capabilities: emptyCapabilities(), parameters: emptyParameters() },
    );
    await app.close();
    app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
    page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.getByRole('button', { name: '面试问答', exact: true }).click();
    await page.getByLabel('目标岗位详情').fill('Engineer role with team collaboration.');
    await page
      .getByLabel('面试使用的简历详情')
      .fill('I built reliable systems and worked in teams.');
    await expect(page.getByLabel('网页资料用途')).toBeVisible();
    await page.getByRole('button', { name: '生成面试问答', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认发送面试资料' })).toBeVisible();
    await page.getByRole('button', { name: '确认发送并生成' }).click();
    await expect(page.locator('.interview-pairs article')).toHaveCount(20);
    await expect(page.locator('.interview-question').first()).toContainText('Q1.');
    await expect(page.locator('.interview-answer').last()).toContainText('A20.');
    await expect(page.locator('.interview-question').first()).toHaveCSS(
      'color',
      'rgb(35, 100, 181)',
    );
    await expect(page.locator('.interview-answer').first()).toHaveCSS('color', 'rgb(35, 130, 80)');
    await page.getByRole('button', { name: '本页记录' }).click();
    await page.getByRole('dialog').getByText('问答生成历史 · 1 条').click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /20 组中英问答 · 恢复显示/ }),
    ).toBeVisible();
  } finally {
    await app.close();
    await mock.close();
  }
});
