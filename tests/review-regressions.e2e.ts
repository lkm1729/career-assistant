import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeFixture } from './native-fixture';
const require = createRequire(import.meta.url);

test('Gemini probe consent shows the exact model endpoint used by text and image requests', async () => {
  const fixture = await nativeFixture();
  mkdirSync('.test-data', { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/review-probe-'));
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
    await page.evaluate(async (baseUrl) => {
      const registry = window.career!.ai.registry;
      const provider = await registry.saveProvider({
        name: 'Review Gemini',
        baseUrl,
        apiKey: 'FAKE-REVIEW-KEY',
        protocol: 'gemini',
      });
      if (!provider.ok) throw new Error('Fixture provider failed');
      const model = await registry.saveModel({
        providerId: provider.catalog.providers[0].id,
        modelId: 'native-model',
        name: 'Review Model',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!model.ok) throw new Error('Fixture model failed');
    }, fixture.baseUrl('gemini'));
    await page.reload();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    for (const kind of ['文本', '图片']) {
      await page
        .getByRole('button', {
          name: `${kind === '文本' ? '测试模型连通性' : '测试图片'} · Review Model`,
          exact: true,
        })
        .click();
      const endpoint =
        fixture.baseUrl('gemini') + '/models/native-model:streamGenerateContent?alt=sse';
      await expect(page.getByRole('region', { name: '测试发送确认' }).locator('code')).toHaveText(
        endpoint,
      );
      const count = fixture.requests.length;
      await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
      await expect(page.locator('.test-records')).toContainText(kind + ' · 已验证通过');
      expect(fixture.requests).toHaveLength(count + 1);
      const sent = fixture.requests[count];
      expect(new URL(sent.path, endpoint).href).toBe(endpoint);
    }
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('page parameter validation and save failures show structured red diagnostics without changing saved values', async () => {
  mkdirSync('.test-data', { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/review-parameters-'));
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
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw new Error('No network allowed in parameter test');
      };
    });
    await page.evaluate(async () => {
      const registry = window.career!.ai.registry;
      const provider = await registry.saveProvider({
        name: 'Review Parameters',
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'FAKE-REVIEW-KEY',
        protocol: 'chat-completions',
      });
      if (!provider.ok) throw new Error('Fixture provider failed');
      const model = await registry.saveModel({
        providerId: provider.catalog.providers[0].id,
        modelId: 'test-model',
        name: 'Parameter Model',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: { temperature: true, maxCompletionTokens: false, reasoningEffort: false },
        parameters: {},
      });
      if (!model.ok) throw new Error('Fixture model failed');
      const selected = await registry.selectModel(
        'resume',
        model.catalog.models[0].id,
        {},
        model.catalog.pages.resume.revision,
      );
      if (!selected.ok) throw new Error('Fixture selection failed');
    });
    await page.reload();
    await page.getByRole('button', { name: '调整', exact: true }).click();
    const temperature = page.getByLabel('温度 · 本页覆盖', { exact: true });
    const save = page.getByRole('button', { name: '保存本页参数', exact: true });
    await temperature.fill('3');
    await save.click();
    const diagnostic = page.getByRole('alert', { name: '错误诊断' });
    await expect(diagnostic).toContainText('AI_CONFIGURATION');
    await expect(diagnostic).toContainText('温度应在 0–2 之间');
    await expect(diagnostic).toContainText('可能原因');
    await expect(diagnostic).toContainText('建议解决办法');
    await expect(diagnostic).toHaveCSS('color', 'rgb(198, 40, 40)');
    expect(
      (await page.evaluate(() => window.career!.ai.registry.catalog())).pages.resume.overrides,
    ).toEqual({});
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('registry:select');
      ipcMain.handle('registry:select', () => ({
        ok: false,
        message: '确认后设置已变化，请重新确认。',
        diagnostic: {
          code: 'AI_STALE_STATE',
          message: '确认后设置已变化，请重新确认。',
          possibleCauses: ['配置变化'],
          solutions: ['重新打开设置'],
        },
      }));
    });
    await temperature.fill('0.4');
    await save.click();
    await expect(diagnostic).toContainText('AI_STALE_STATE');
    await expect(diagnostic).toContainText('重新打开设置');
    await expect(temperature).toHaveValue('0.4');
    expect(
      (await page.evaluate(() => window.career!.ai.registry.catalog())).pages.resume.overrides,
    ).toEqual({});
  } finally {
    await app.close();
  }
});
