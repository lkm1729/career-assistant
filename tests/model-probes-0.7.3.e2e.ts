import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeFixture } from './native-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
for (const protocol of ['gemini', 'anthropic'] as const) {
  test(`${protocol}: model editor probe requires confirmation, tests only selected model, and compatible stream generates V1`, async ({}, info) => {
    test.setTimeout(180000);
    const mock = await nativeFixture();
    mock.setMode('compatible');
    mkdirSync('.test-data', { recursive: true });
    const directory = mkdtempSync(resolve('.test-data/model-probes-073-'));
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      CAREER_TEST_MODE: '1',
      CAREER_TEST_DATA: directory,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CAREER_DEV_URL;
    const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
      await page.evaluate(
        async ({ protocol, baseUrl }) => {
          const registry = window.career!.ai.registry;
          const result = await registry.saveProvider({
            name: 'Probe Owner',
            baseUrl,
            apiKey: 'FAKE-073-KEY',
            protocol,
          });
          if (!result.ok) throw new Error('fixture provider');
          const owner = result.catalog.providers[0];
          await registry.saveModel({
            providerId: owner.id,
            name: 'Untested Model',
            modelId: 'untested-model',
            protocol: 'inherit',
            capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
            parameterSupport: {
              temperature: false,
              maxCompletionTokens: false,
              reasoningEffort: false,
            },
            parameters: {},
          });
        },
        { protocol, baseUrl: mock.baseUrl(protocol) },
      );
      await page.reload();
      await page.getByRole('button', { name: '应用设置', exact: true }).click();
      await page.getByRole('button', { name: '添加模型', exact: true }).click();
      await page.getByLabel('模型 ID', { exact: true }).fill('tested-model');
      await page.getByLabel('模型显示名称', { exact: true }).fill('Tested Model');
      await page.getByRole('button', { name: '保存并测试模型连通性', exact: true }).click();
      const confirmation = page.getByRole('region', { name: '测试发送确认' });
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toBeFocused();
      await expect(confirmation).toContainText('tested-model');
      expect(mock.requests).toHaveLength(0);
      // Saving from the editor does not bypass the second explicit confirmation.
      await confirmation.getByRole('button', { name: '取消', exact: true }).click();
      expect(mock.requests).toHaveLength(0);
      await page
        .getByRole('button', { name: '测试模型连通性 · Tested Model', exact: true })
        .click();
      await confirmation.getByRole('button', { name: '确认发送测试', exact: true }).click();
      const card = page.locator('.model-card').filter({
        has: page.getByRole('button', { name: '测试模型连通性 · Tested Model', exact: true }),
      });
      await expect(card).toContainText('文本 · 已验证通过');
      expect(mock.requests).toHaveLength(1);
      const catalog = await page.evaluate(() => window.career!.ai.registry.catalog());
      expect(catalog.models.find((m) => m.modelId === 'untested-model')!.tests).toHaveLength(0);
      expect(catalog.models.find((m) => m.modelId === 'tested-model')!.tests).toHaveLength(1);
      expect(catalog.providers[0].test).toBeUndefined();
      if (protocol === 'gemini')
        expect(mock.requests[0].path).toContain('/models/tested-model:streamGenerateContent');
      else expect(mock.requests[0].body.model).toBe('tested-model');
      await captureWindow(app, info.outputPath(protocol + '-model-probe.png'));
      await page.getByRole('button', { name: '编辑模型 Tested Model', exact: true }).click();
      await page.getByRole('button', { name: '保存并测试模型连通性', exact: true }).click();
      expect(mock.requests).toHaveLength(1);
      await confirmation.getByRole('button', { name: '确认发送测试', exact: true }).click();
      await expect(card).toContainText('文本 · 已验证通过');
      expect(mock.requests).toHaveLength(2);
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: 'Tested Model / Probe Owner' });
      await page.locator('#user-prompt').fill('虚构测试经历：项目开发');
      await page.getByRole('button', { name: '生成简历', exact: true }).click();
      await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
      const versions = await page.evaluate(() => window.career!.ai.listResumeVersions());
      expect(versions[0].document).toContain('原生协议生成正文');
      expect(JSON.stringify(versions)).not.toContain('PRIVATE-SIGNATURE');
    } finally {
      await app.close();
      await mock.close();
    }
  });
}
