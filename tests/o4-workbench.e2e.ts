import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { seedO4 } from './o4-fixture';
import { pages } from '../src/content';
import { captureWindow } from './capture-window';
import { nativeFixture } from './native-fixture';
const require = createRequire(import.meta.url);
async function desktop() {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o4-desktop-'));
  seedO4(join(dir, 'workspace.sqlite'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const launch = () =>
    electron.launch({
      executablePath: require('electron'),
      args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
      env,
    });
  let app = await launch();
  let window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await expect(window.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return {
    get app() {
      return app;
    },
    get window() {
      return window;
    },
    async restart() {
      await app.close();
      app = await launch();
      window = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
      );
      await expect(window.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    },
    async close() {
      await app.close();
    },
  };
}
for (const pageId of ['resume', 'score', 'match', 'letter'] as const) {
  test(`O4 ${pageId}: cancel/clear/undo/restart/history and input isolation`, async ({}, info) => {
    const f = await desktop();
    try {
      const navigate = () =>
        f.window.getByRole('button', { name: pages[pageId].name, exact: true }).click();
      await navigate();
      const writing = pageId === 'resume' || pageId === 'letter';
      const before = await f.window.evaluate(async () => {
        const api = window.career!;
        return {
          snapshot: await api.load(),
          attachments: await Promise.all(
            ['resume', 'score', 'match', 'letter'].map((p) => api.materials.list(p as 'resume')),
          ),
          versions: await api.ai.getHistory('resume'),
          letter: await api.ai.getHistory('letter'),
          scores: await api.score.history(),
          matches: await api.match.history(),
          catalog: await api.ai.registry.catalog(),
        };
      });
      if (writing) {
        await f.window.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
        await f.window.getByLabel('正文草稿', { exact: true }).fill(`${pageId} MANUAL EDIT`);
      }
      await f.window.getByRole('button', { name: '清空当前结果', exact: true }).click();
      const dialog = f.window.getByRole('dialog');
      await expect(dialog).toContainText('重启后不会自动重新显示旧成果');
      if (writing) await expect(dialog).toContainText('手动编辑的正文也会清空');
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      expect(
        (await f.window.evaluate((p) => window.career!.workbench.inspect(p), pageId)).hasResult,
      ).toBe(true);
      await f.window.getByRole('button', { name: '清空当前结果', exact: true }).click();
      await f.window.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
      await expect(f.window.getByRole('region', { name: '清空成果操作反馈' })).toContainText(
        '当前成果已清空',
      );
      await expect(
        f.window.getByRole('button', { name: '清空当前结果', exact: true }),
      ).toBeDisabled();
      if (writing) {
        await expect(f.window.getByLabel('正文草稿', { exact: true })).toHaveValue('');
        await expect(f.window.locator('.generated-advice')).not.toContainText(
          `${pageId} unique advice`,
        );
      } else if (pageId === 'score') {
        await expect(f.window.locator('.evaluation-panel > .summary-block')).toHaveCount(0);
        await expect(f.window.locator('.evaluation-panel > .score-overview')).toContainText(
          '尚未完成评价',
        );
      } else
        await expect(f.window.locator('.evaluation-panel')).not.toContainText('O4 match summary');
      const cleared = await f.window.evaluate((p) => window.career!.workbench.inspect(p), pageId);
      expect(cleared.hasResult).toBe(false);
      expect(cleared.canUndo).toBe(true);
      for (const key of [
        'prompt',
        'systemPrompt',
        'refinement',
        'links',
        'resumeText',
        'evidenceText',
      ] as const)
        expect(cleared.draft[key]).toBe(before.snapshot.workspaces[pageId][key]);
      if (!writing)
        expect(cleared.draft.document).toBe(before.snapshot.workspaces[pageId].document);
      await f.restart();
      await navigate();
      await expect(
        f.window.getByRole('button', { name: '清空当前结果', exact: true }),
      ).toBeDisabled();
      await expect(
        f.window.getByRole('button', { name: '恢复刚清空的结果', exact: true }),
      ).toBeVisible();
      if (pageId === 'match') {
        await f.window.evaluate(async () => {
          const s = await window.career!.load();
          await window.career!.savePreferences({ ...s.preferences, theme: 'dark' });
        });
        await f.window.reload();
        await f.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(920, 900),
        );
      }
      await f.window
        .locator('.clear-result-control')
        .evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await f.window.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      // Native hidden capture needs one compositor turn after the DOM scroll.
      await f.window.waitForTimeout(200);
      await captureWindow(f.app, info.outputPath(`o4-${pageId}-cleared.png`));
      await f.window.getByRole('button', { name: '恢复刚清空的结果', exact: true }).click();
      await expect(f.window.getByRole('region', { name: '清空成果操作反馈' })).toContainText(
        '已恢复刚清空',
      );
      const restored = await f.window.evaluate((p) => window.career!.workbench.inspect(p), pageId);
      expect(restored.hasResult).toBe(true);
      expect(restored.draft.document).toBe(
        writing ? `${pageId} MANUAL EDIT` : before.snapshot.workspaces[pageId].document,
      );
      // Clear again, then recover through the persistent history entry, not Undo.
      await f.window.getByRole('button', { name: '清空当前结果', exact: true }).click();
      await f.window.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
      await expect(f.window.getByRole('region', { name: '清空成果操作反馈' })).toContainText(
        '当前成果已清空',
      );
      if (writing) {
        await f.window.getByLabel('切换工作版本').selectOption('1');
        await expect(f.window.getByLabel('正文草稿', { exact: true })).toHaveValue(
          `# ${pageId} generated result`,
        );
        await expect(f.window.locator('.generated-advice')).toContainText(
          `${pageId} unique advice`,
        );
      } else {
        const history = f.window.locator('.evaluation-panel .score-history');
        await history.locator('summary').first().click();
        // O10 adds toolbar buttons; select an actual history row, not the toolbar.
        await history.locator('.history-select-row > button').first().click();
        await expect(f.window.locator('.evaluation-panel')).toContainText(
          pageId === 'score' ? 'O4 score summary' : 'O4 match summary',
        );
      }
      await f.restart();
      await navigate();
      await expect(
        f.window.getByRole('button', { name: '清空当前结果', exact: true }),
      ).toBeEnabled();
      const after = await f.window.evaluate(async () => {
        const api = window.career!;
        return {
          snapshot: await api.load(),
          attachments: await Promise.all(
            ['resume', 'score', 'match', 'letter'].map((p) => api.materials.list(p as 'resume')),
          ),
          versions: await api.ai.getHistory('resume'),
          letter: await api.ai.getHistory('letter'),
          scores: await api.score.history(),
          matches: await api.match.history(),
          catalog: await api.ai.registry.catalog(),
        };
      });
      expect(after.attachments).toEqual(before.attachments);
      expect(after.versions.versions).toEqual(before.versions.versions);
      expect(after.letter.versions).toEqual(before.letter.versions);
      expect(after.scores).toEqual(before.scores);
      expect(after.matches).toEqual(before.matches);
      expect(after.catalog).toEqual(before.catalog);
      for (const other of ['resume', 'score', 'match', 'letter'] as const)
        if (other !== pageId)
          expect(after.snapshot.workspaces[other]).toEqual(before.snapshot.workspaces[other]);
    } finally {
      await f.close();
    }
  });
}
test('O4 main-process stale confirmation and active-request guards match disabled desktop action', async () => {
  const f = await desktop();
  const mock = await nativeFixture();
  try {
    await f.window.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await f.window.getByRole('button', { name: '清空当前结果', exact: true }).click();
    await f.window.evaluate(async () => {
      const api = window.career!;
      const s = await api.load();
      await api.saveWorkspace('match', {
        ...s.workspaces.match,
        prompt: 'Changed since clear confirmation',
      });
    });
    await f.window.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
    await expect(f.window.getByRole('region', { name: '清空成果操作反馈' })).toContainText(
      '确认后已改变',
    );
    expect(
      (await f.window.evaluate(() => window.career!.workbench.inspect('match'))).hasResult,
    ).toBe(true);
    await f.window.evaluate(async (baseUrl) => {
      const r = window.career!.ai.registry;
      const p = await r.saveProvider({
        name: 'local',
        baseUrl,
        protocol: 'anthropic',
        apiKey: 'FAKE-KEY',
      });
      if (!p.ok) throw Error('provider');
      const m = await r.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw Error('model');
      await r.selectModel('match', m.catalog.models[0].id, {}, m.catalog.pages.match.revision);
    }, mock.baseUrl('anthropic'));
    mock.setMode('slow');
    await f.window.reload();
    await f.window.getByRole('button', { name: '评估匹配度', exact: true }).click();
    await f.window.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
    await expect.poll(() => mock.requests.length).toBe(1);
    await expect(
      f.window.getByRole('button', { name: '清空当前结果', exact: true }),
    ).toBeDisabled();
    const reply = await f.window.evaluate(async () => {
      const api = window.career!;
      return api.workbench.clear(await api.workbench.inspect('match'));
    });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.diagnostic.code).toBe('AI_BUSY');
    await f.window.getByRole('button', { name: '取消匹配', exact: true }).first().click();
    await expect(f.window.getByRole('button', { name: '清空当前结果', exact: true })).toBeEnabled();
    expect((await f.window.evaluate(() => window.career!.match.history())).length).toBe(1);
    expect(mock.requests.length).toBe(1);
  } finally {
    await f.close();
    await mock.close();
  }
});
