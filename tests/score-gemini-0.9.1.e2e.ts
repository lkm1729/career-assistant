import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeFixture } from './native-fixture';
import { appVersion } from '../shared/version';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
test('Gemini score handles null optional fields, reports safe field errors, preserves history; all pages share the package version', async ({}, info) => {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/score-091-'));
  let invalid = false;
  const fixture = await nativeFixture(() =>
    JSON.stringify({
      dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
        key,
        score: key === 'visual' ? null : 80,
        evidence:
          key === 'visual'
            ? null
            : [
                {
                  sourceId: 'paste',
                  quote: invalid ? 'PRIVATE-INVALID-QUOTE' : 'Built tested software',
                },
              ],
        example: null,
        issues: [],
        suggestions: [],
      })),
      summary: 'Verified source, improve measurable results',
      coveredPages: [],
      unreadablePages: [],
      conflicts: [],
    }),
  );
  fixture.setMode('compatible');
  const env: Record<string, string> = {
    ...process.env,
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
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    for (const name of ['设计简历', '简历评分', '岗位匹配', '撰写求职信']) {
      await page
        .getByRole('navigation', { name: '求职工具' })
        .getByRole('button', { name, exact: false })
        .click();
      await expect(page.locator('.sidebar-meta')).toContainText(appVersion);
      await expect(page.locator('.page-footer')).toContainText(appVersion);
      expect(await page.locator('body').innerText()).not.toMatch(/0\.7\.2|0\.9\.0/);
    }
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(appVersion);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.evaluate(async (baseUrl) => {
      const registry = window.career!.ai.registry;
      const p = await registry.saveProvider({
        name: 'Gemini fixture',
        protocol: 'gemini',
        baseUrl,
        apiKey: 'FAKE-SCORE-KEY',
      });
      if (!p.ok) throw new Error('fixture provider');
      const m = await registry.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'Score model',
        modelId: 'score-fixture',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'supported' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw new Error('fixture model');
      await registry.selectModel(
        'score',
        m.catalog.models[0].id,
        {},
        m.catalog.pages.score.revision,
      );
    }, fixture.baseUrl('gemini'));
    await page.reload();
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字').fill('Built tested software');
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Gemini 原生 JSON Schema');
    expect(fixture.requests).toHaveLength(0);
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(page.locator('.evaluation-panel .pill')).toContainText('已保存独立评估');
    expect(fixture.requests[0].body.generationConfig.responseMimeType).toBe('application/json');
    await expect(page.locator('.evaluation-panel .score-number').first()).toContainText('—');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(1);
    invalid = true;
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(page.locator('.evaluation-panel .ai-error')).toContainText('AI_SCORE_EVIDENCE');
    await expect(page.locator('.evaluation-panel .ai-error')).toContainText(
      'dimensions[0].evidence[0].quote',
    );
    await expect(page.locator('.evaluation-panel .ai-error')).not.toContainText(
      'PRIVATE-INVALID-QUOTE',
    );
    await expect(page.locator('.evaluation-panel .ai-error')).not.toContainText('FAKE-SCORE-KEY');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(1);
    expect(fixture.requests).toHaveLength(2);
    await page.locator('.evaluation-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await captureWindow(app, info.outputPath('safe-score-diagnostic.png'));
  } finally {
    await app.close();
    await fixture.close();
  }
});
