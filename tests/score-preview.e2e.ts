import { test, expect } from '@playwright/test';
import { launch, dataDir } from './o7-web-fixture';
import { scorePreviewFixture, SCORE_FIXTURE_KEY } from './score-preview-fixture';
import { captureWindow } from './capture-window';
for (const protocol of ['chat-completions', 'anthropic'] as const) {
  test(`score diagnostic ${protocol}: one-run opt-in, private view, reviewed copy, disposal and restart`, async ({}, info) => {
    const net = await scorePreviewFixture(protocol);
    const dir = dataDir();
    let { app, page } = await launch(dir);
    try {
      await page.evaluate(
        async ({ protocol, baseUrl, apiKey }) => {
          const api = window.career!;
          const saved = await api.ai.registry.saveProvider({
            name: 'LOCAL synthetic',
            protocol,
            baseUrl,
            apiKey,
          });
          if (!saved.ok) throw Error('provider');
          const p = saved.catalog.providers.find((p) => p.name === 'LOCAL synthetic')!;
          const model = await api.ai.registry.saveModel({
            providerId: p.id,
            name: 'Synthetic Claude',
            modelId: 'synthetic',
            protocol: 'inherit',
            capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
            parameterSupport: {
              temperature: true,
              maxCompletionTokens: true,
              reasoningEffort: false,
            },
            parameters: { maxCompletionTokens: 4096 },
          });
          if (!model.ok) throw Error('model');
          const m = model.catalog.models.find((m) => m.name === 'Synthetic Claude')!;
          await api.ai.registry.selectModel('score', m.id, {}, model.catalog.pages.score.revision);
          const snapshot = await api.load();
          await api.saveWorkspace('score', {
            ...snapshot.workspaces.score,
            document: 'TypeScript',
          });
        },
        { protocol, baseUrl: net.baseUrl, apiKey: SCORE_FIXTURE_KEY },
      );
      await page.reload();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: '简历评分', exact: true })
        .click();
      async function run(optIn: boolean) {
        const n = net.requests.length;
        await page.getByRole('button', { name: '开始评分', exact: true }).click();
        const consent = page.getByRole('checkbox', {
          name: '仅本次评分JSON或维度校验失败时保留响应供本机诊断',
          exact: true,
        });
        await expect(consent).not.toBeChecked();
        if (optIn) await consent.check();
        await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
        await expect.poll(() => net.requests.length).toBe(n + 1);
      }
      net.setMode('valid');
      await run(false);
      await expect
        .poll(async () => (await page.evaluate(() => window.career!.score.history())).length)
        .toBe(1);
      const saved = await page.evaluate(() => window.career!.score.history());
      net.setMode('invalid');
      await run(false);
      await expect(page.locator('.evaluation-panel > .ai-error')).toContainText('AI_SCORE_JSON');
      const view = () =>
        page.getByRole('button', { name: '查看本次评分失败响应（仅本机）', exact: true });
      await expect(view()).toHaveCount(0);
      await run(true);
      await expect(view()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('PRIVATE-CONTENT');
      expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
      await view().click();
      await expect(page.getByRole('dialog')).toContainText('不是完整脱敏');
      await page.getByRole('button', { name: '我了解，仅在本机查看评分响应', exact: true }).click();
      const text = page.getByRole('textbox', {
        name: '评分失败响应文本（可手动脱敏）',
        exact: true,
      });
      expect(await text.inputValue()).toContain('PRIVATE-CONTENT');
      expect(await text.inputValue()).toContain('[API KEY REDACTED]');
      expect(await text.inputValue()).not.toContain(SCORE_FIXTURE_KEY);
      const copy = page.getByRole('button', { name: '复制已检查的当前文本', exact: true });
      await expect(copy).toBeDisabled();
      // Fake clipboard boundary, never reads or writes the user's real clipboard.
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              Reflect.set(window, 'copiedPreview', value);
            },
          },
        }),
      );
      await text.fill('{"summary":"REDACTED" "missing comma":true}');
      await page
        .getByRole('checkbox', {
          name: '我已检查当前文本中的个人信息，同意复制到系统剪贴板',
          exact: true,
        })
        .check();
      await copy.click();
      expect(await page.evaluate(() => Reflect.get(window, 'copiedPreview'))).toBe(
        '{"summary":"REDACTED" "missing comma":true}',
      );
      await text.fill('changed after review');
      await expect(copy).toBeDisabled();
      await app.evaluate(async ({ BrowserWindow }) => {
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await captureWindow(app, info.outputPath(`${protocol}-preview.png`));
      await page.getByRole('button', { name: '关闭并清除评分响应', exact: true }).click();
      await expect(text).toHaveCount(0);
      await expect(view()).toHaveCount(0);
      await run(true);
      await expect(view()).toBeVisible();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: '设计简历', exact: true })
        .click();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: '简历评分', exact: true })
        .click();
      await expect(view()).toHaveCount(0);
      expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
      await run(true);
      await expect(view()).toBeVisible();
      await page.clock.install();
      await view().click();
      await page.getByRole('button', { name: '我了解，仅在本机查看评分响应', exact: true }).click();
      await expect(text).toBeVisible();
      await page.clock.fastForward(5 * 60_000 + 1000);
      await expect(text).toHaveCount(0);
      await expect(page.getByRole('region', { name: '评分失败响应诊断' })).toContainText(
        '已到期并清除',
      );
      await page.clock.resume();
      // Main-process preview TTL uses real time; restore renderer time after expiry simulation.
      await page.clock.setSystemTime(new Date());
      net.setMode('dimensions');
      await run(false);
      await expect(page.locator('.evaluation-panel > .ai-error')).toContainText(
        'AI_SCORE_DIMENSIONS',
      );
      await expect(page.locator('.evaluation-panel > .ai-error')).toContainText(
        'count=3; missing=expression',
      );
      await expect(view()).toHaveCount(0);
      await run(true);
      await expect(view()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('PRIVATE-CONTENT');
      await view().click();
      await page.getByRole('button', { name: '我了解，仅在本机查看评分响应', exact: true }).click();
      expect(await text.inputValue()).toContain('[API KEY REDACTED]');
      expect(await text.inputValue()).not.toContain(SCORE_FIXTURE_KEY);
      expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
      await app.close();
      ({ app, page } = await launch(dir));
      await expect(view()).toHaveCount(0);
      expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
      expect(net.requests).toHaveLength(7);
      expect(JSON.stringify(net.requests)).not.toContain('retainFailedResponse');
    } finally {
      await app.close();
      await net.close();
    }
  });
}
