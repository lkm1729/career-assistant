import { BRACKET_SOURCE, bracketScore, malformedBracketScore } from './score-bracket-fixture';
import { malformedPlaceholderScore, placeholderScore } from './score-placeholder-fixture';
import { test, expect } from '@playwright/test';
import { launch, dataDir } from './o7-web-fixture';
import { scorePreviewFixture, SCORE_FIXTURE_KEY } from './score-preview-fixture';
import { captureWindow } from './capture-window';
import { malformedProseScore, proseScore } from './score-prose-fixture';
import { malformedCompactScore, compactProseScore } from './score-prose-compact-fixture';
for (const protocol of ['chat-completions', 'anthropic'] as const) {
  for (const scenario of [
    {
      name: 'bracket-evidence',
      body: malformedBracketScore(false, 2),
      expected: bracketScore(),
      source: BRACKET_SOURCE,
    },
    {
      name: 'bracket-example-alias',
      body: malformedBracketScore(true),
      expected: bracketScore(true),
      source: BRACKET_SOURCE,
    },
    {
      name: 'numeric-placeholder',
      body: malformedPlaceholderScore(),
      expected: placeholderScore(),
    },
    { name: 'legacy', body: malformedProseScore(), expected: proseScore() },
    { name: 'compact', body: malformedCompactScore(), expected: compactProseScore() },
    {
      name: 'pretty-summary-example',
      body: malformedCompactScore(2),
      expected: compactProseScore(),
    },
  ]) {
    test(`Claude prose ${protocol}/${scenario.name}: display exact quoted advice, save once and persist`, async ({}, info) => {
      const net = await scorePreviewFixture(protocol, scenario.body);
      const dir = dataDir();
      let { app, page } = await launch(dir);
      try {
        await page.evaluate(
          async ({ protocol, baseUrl, apiKey, source }) => {
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
            await api.ai.registry.selectModel(
              'score',
              m.id,
              {},
              model.catalog.pages.score.revision,
            );
            const snapshot = await api.load();
            await api.saveWorkspace('score', {
              ...snapshot.workspaces.score,
              document: source,
            });
          },
          {
            protocol,
            baseUrl: net.baseUrl,
            apiKey: SCORE_FIXTURE_KEY,
            source: scenario.source ?? 'TypeScript',
          },
        );
        await page.reload();
        await page
          .getByRole('navigation')
          .getByRole('button', { name: '简历评分', exact: true })
          .click();
        net.setMode('valid');
        await page.getByRole('button', { name: '开始评分', exact: true }).click();
        await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
        const panel = page.locator('.evaluation-panel');
        await expect(panel).toContainText('PROSE_QUOTES');
        await expect(panel).toContainText(
          scenario.name === 'legacy'
            ? '将"Built a demo"改为"Built a tested demo"'
            : '例如"支持分析章节"',
        );
        await expect(panel).not.toContainText('评分校验失败');
        const saved = await page.evaluate(() => window.career!.score.history());
        expect(saved).toHaveLength(1);
        expect(saved[0].dimensions[0].suggestions).toEqual(
          scenario.expected.dimensions[0].suggestions,
        );
        expect(saved[0].summary).toEqual(scenario.expected.summary);
        if (scenario.name !== 'legacy')
          expect(saved[0].dimensions[3].example).toEqual(scenario.expected.dimensions[3].example);
        if (scenario.source) expect(saved[0].dimensions[1].evidence[0].quote).toBe(BRACKET_SOURCE);
        if (scenario.name === 'bracket-example-alias')
          await expect(panel).toContainText('EMPTY_EXAMPLE_PLACEHOLDER');
        expect(saved[0].total).toBeNull();
        expect(saved[0].dimensions).toHaveLength(4);
        if (scenario.name === 'numeric-placeholder') {
          await expect(panel).toContainText('EMPTY_EXAMPLE_PLACEHOLDER');
          expect(saved[0].dimensions[2].issues).toContain(
            scenario.expected.dimensions[2].issues.at(-1),
          );
        }
        expect(net.requests).toHaveLength(1);
        await panel.evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await captureWindow(app, info.outputPath('score-prose-wake.png'));
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await captureWindow(app, info.outputPath('score-prose-success.png'));
        net.setMode('evidence');
        await page.getByRole('button', { name: '开始评分', exact: true }).click();
        await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
        await expect(
          page
            .getByRole('alert', { name: '错误诊断' })
            .getByText('AI_SCORE_EVIDENCE', { exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
        expect(net.requests).toHaveLength(2);
        await app.close();
        ({ app, page } = await launch(dir));
        expect(await page.evaluate(() => window.career!.score.history())).toEqual(saved);
      } finally {
        await app.close();
        await net.close();
      }
    });
  }
}
