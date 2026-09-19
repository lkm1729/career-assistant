import { revealConfirmation } from './confirmation-preview';
import { appVersion } from '../shared/version';
import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { anthropicScoreFixture } from './anthropic-score-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
test('Anthropic score JSON hotfix normalizes only safe syntax and preserves history without retries', async ({}, info) => {
  test.setTimeout(240000); // Multiple independent malformed-response cases, preview expansion and restart.
  const f = await anthropicScoreFixture();
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/anthropic-score-ui-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const launch = async () => {
    const app = await electron.launch({
      executablePath: require('electron'),
      args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
      env,
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
    );
    return app;
  };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.evaluate(async (baseUrl) => {
      const r = window.career!.ai.registry;
      const p = await r.saveProvider({
        name: 'Local synthetic - not OpenLux',
        baseUrl,
        apiKey: 'FAKE-SCORE-KEY',
        protocol: 'anthropic',
      });
      if (!p.ok) throw Error('provider');
      const m = await r.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'Claude fixture',
        modelId: 'claude-sonnet-5',
        protocol: 'inherit',
        capabilities: { images: 'supported', files: 'supported', structuredOutput: 'supported' },
        parameterSupport: { temperature: true, maxCompletionTokens: true, reasoningEffort: false },
        parameters: { maxCompletionTokens: 64000 },
      });
      if (!m.ok) throw Error('model');
      await r.selectModel('score', m.catalog.models[0].id, {}, m.catalog.pages.score.revision);
    }, f.baseUrl);
    await page.reload();
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字').fill('TypeScript');
    const score = async () => {
      await page.getByRole('button', { name: '开始评分', exact: true }).click();
      await revealConfirmation(page);
      await expect(page.getByRole('dialog')).toContainText('64000');
      await expect(page.getByRole('dialog')).toContainText('Anthropic 原生 JSON Schema 约束');
      await expect(page.getByRole('dialog')).toContainText('最多等待30分钟');
      await expect(page.getByRole('dialog')).toContainText('连续10分钟无任何响应数据会停止');
      await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    };
    await score();
    await expect(page.getByRole('region', { name: '简历评分操作反馈', exact: true })).toContainText(
      '评分结果已保存',
    );
    for (const mode of [
      'json-trailing-comma',
      'json-controls',
      'json-comments',
      'json-combined',
    ] as const) {
      f.setMode(mode);
      await score();
      await expect(
        page.getByRole('region', { name: '简历评分操作反馈', exact: true }),
      ).toContainText('评分结果已保存');
      await expect(page.locator('.evaluation-panel > .ai-error')).toHaveCount(0);
      const latest = await page.evaluate(() => window.career!.score.history());
      expect(latest[0].warnings.join(' ')).toContain('规范化');
    }
    const original = await page.evaluate(() => window.career!.score.history());
    expect(original).toHaveLength(5);
    expect(original[0].dimensions[0].score).toBe(80);
    expect(original[0].total).toBeNull();
    expect(f.requests).toHaveLength(5);
    await expect(page.locator('.sidebar-meta')).toContainText(appVersion);
    expect(f.requests[0].max_tokens).toBe(64000);
    expect(f.requests[0].thinking).toBeUndefined();
    expect(f.requests[0].output_config.format.type).toBe('json_schema');
    for (const [mode, code, detail] of [
      ['wrong-index', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA', 'reason=INDEX_MISMATCH'],
      ['wrong-type', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA', 'reason=BLOCK_TYPE_MISMATCH'],
      ['no-signature', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_STOP', 'signature=not-started'],
      ['unknown-source', 'AI_SCORE_EVIDENCE', 'dimensions[3].evidence[2].sourceId'],
      ['schema-rejected', 'AI_HTTP_400', '400'],
      ['invalid-json', 'AI_SCORE_JSON', 'shape=UNCLOSED_CONTAINER'],
      ['json-ambiguous', 'AI_SCORE_JSON', 'reason=SEPARATOR_REQUIRED'],
      ['json-normalized-invalid-score', 'AI_SCORE_EVIDENCE', 'quote'],
    ] as const) {
      f.setMode(mode);
      const n = f.requests.length;
      await score();
      const error = page.locator('.evaluation-panel > .ai-error');
      await expect(error).toContainText(code);
      await expect(error).toContainText(detail);
      await expect(error).not.toContainText('PRIVATE');
      await expect(error).not.toContainText('FAKE-SCORE-KEY');
      expect(await page.evaluate(() => window.career!.score.history())).toEqual(original);
      expect(f.requests).toHaveLength(n + 1);
      await expect(page.getByRole('button', { name: '开始评分', exact: true })).toBeEnabled();
    }
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await page.locator('.evaluation-panel > .ai-error').scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    await captureWindow(app, info.outputPath('score-json-hotfix-diagnostic.png'));
    f.setMode('json-combined');
    await score();
    await expect(page.getByRole('region', { name: '简历评分操作反馈', exact: true })).toContainText(
      '评分结果已保存',
    );
    await expect(page.getByRole('button', { name: '开始评分', exact: true })).toBeEnabled();
    await expect(page.locator('.evaluation-panel > .ai-error')).toHaveCount(0);
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    await captureWindow(app, info.outputPath('score-json-hotfix-success.png'));
    const saved = await page.evaluate(() => window.career!.score.history());
    expect(saved).toHaveLength(6);
    expect(JSON.stringify(saved)).not.toMatch(/PRIVATE|FAKE-SCORE-KEY/);
    expect(f.requests).toHaveLength(14);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.locator('.score-overview').first()).toContainText('部分评价');
    expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
    expect(f.requests).toHaveLength(14);
  } finally {
    await app.close();
    await f.close();
  }
});
