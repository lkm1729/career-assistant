import { expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './o7-web-fixture';
import { responsesFixture } from './responses-fixture';
import { pdfFixture } from './material-fixtures';
export type ReviewMode =
  'complete' | 'omitted' | 'unreadable' | 'dimension' | 'conflict' | 'invalid';
export async function scoreDesktop() {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o8-desktop-'));
  let mode: ReviewMode = 'complete';
  const mock = await responsesFixture((input) => {
    const messages = JSON.parse(input);
    const user = messages.find((m: { role: string }) => m.role === 'user');
    const facts = JSON.parse(
      user.content.find((p: { text?: string }) => p.text?.includes('allowedVisualPages')).text,
    );
    const ids: string[] = facts.allowedVisualPages;
    const sourceId = facts.allowedEvidenceSources[0];
    return JSON.stringify({
      dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => {
        const absent =
          (key === 'visual' && !ids.length) || (key === 'relevance' && mode === 'dimension');
        return {
          key,
          score: absent ? null : 80,
          evidence: absent
            ? []
            : [
                {
                  sourceId: mode === 'invalid' ? 'NOT-SENT:p1' : sourceId,
                  quote: sourceId === 'paste' ? 'Fictional resume' : 'CAREER RESUME',
                },
              ],
          issues: [],
          suggestions: ['Use verifiable examples'],
        };
      }),
      summary: 'Fictional O8 review',
      coveredPages: mode === 'omitted' || mode === 'unreadable' ? ids.slice(0, -1) : ids,
      unreadablePages: mode === 'unreadable' ? ids.slice(-1) : [],
      conflicts: mode === 'conflict' ? ['Dates conflict in supplied sources'] : [],
    });
  });
  let { app, page } = await launch(dir);
  await page.evaluate(async (baseUrl) => {
    const api = window.career!;
    const p = await api.ai.registry.saveProvider({
      name: 'O8 Local Fixture',
      baseUrl,
      protocol: 'responses',
      apiKey: 'FAKE-O8',
    });
    if (!p.ok) throw Error('provider fixture');
    const m = await api.ai.registry.saveModel({
      providerId: p.catalog.providers[0].id,
      name: 'O8 Vision',
      modelId: 'o8-fixture',
      protocol: 'inherit',
      capabilities: { images: 'supported', files: 'unknown', structuredOutput: 'unknown' },
      parameterSupport: { temperature: false, maxCompletionTokens: false, reasoningEffort: false },
      parameters: {},
    });
    if (!m.ok) throw Error('model fixture');
    const selected = await api.ai.registry.selectModel(
      'score',
      m.catalog.models[0].id,
      {},
      m.catalog.pages.score.revision,
    );
    if (!selected.ok) throw Error('select fixture');
  }, mock.baseUrl);
  await page.reload();
  await page.getByRole('button', { name: '简历评分', exact: true }).click();
  return {
    dir,
    get app() {
      return app;
    },
    get page() {
      return page;
    },
    mock,
    setMode: (next: ReviewMode) => {
      mode = next;
    },
    async importResume(pages = 2) {
      const pdf = join(dir, 'O8 CV.pdf');
      writeFileSync(pdf, pdfFixture(pages));
      const privateFile = join(dir, 'PRIVATE-unselected.txt');
      writeFileSync(privateFile, 'PRIVATE-NOT-SENT');
      await app.evaluate(
        ({ dialog }, filePaths) => {
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths,
          })) as typeof dialog.showOpenDialog;
        },
        [pdf, privateFile],
      );
      await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
      await page.getByLabel('第2个文件用途', { exact: true }).selectOption('evidence');
      await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: '发送资料 O8 CV.pdf', exact: true }),
      ).toBeVisible();
      await page.getByRole('checkbox', { name: '发送资料 O8 CV.pdf', exact: true }).check();
    },
    async prepare() {
      await page.getByRole('button', { name: '开始评分', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '确认本次简历评分' });
      await expect(dialog).toBeVisible();
      return dialog;
    },
    async reopen(seed?: () => void) {
      await app.close();
      seed?.();
      ({ app, page } = await launch(dir));
    },
    async close() {
      await app.close();
      await mock.close();
    },
  };
}
