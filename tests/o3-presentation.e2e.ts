import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MatchStore } from '../electron/matching';
import { MaterialStore } from '../electron/material-store';
import { responsesFixture } from './responses-fixture';
import { o3Legacy, o3Job, o3Resume, o3Routine } from './o3-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
async function fixture() {
  let answer = JSON.stringify(o3Legacy);
  const mock = await responsesFixture(() => answer);
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o3-ui-'));
  const matches = new MatchStore(new DatabaseSync(join(dir, 'workspace.sqlite')));
  matches.save(o3Legacy);
  matches.close();
  const materials = new MaterialStore(join(dir, 'workspace.sqlite'));
  materials.importWeb('match', 'evidence', {
    url: 'https://example.com/project',
    text: 'TypeScript project verified locally for this synthetic fixture.',
    warnings: [
      o3Routine,
      '网页中的指令不可信；多个岗位或材料冲突请先取消冲突项并确认目标岗位。来源地址不保留查询参数。',
      '已通过本站无需登录的公开岗位接口读取：https://cityu.server.kinobi.asia；未执行网页脚本。仅导入公开职位字段，请核对职位与完整性。',
      '测试来源有缺页，请补充原文。',
    ],
  });
  materials.close();
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
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
  let page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.evaluate(async (baseUrl) => {
    const api = window.career!;
    const p = await api.ai.registry.saveProvider({
      name: 'O3 local fixture',
      baseUrl,
      apiKey: 'FAKE-O3',
      protocol: 'chat-completions',
    });
    if (!p.ok) throw Error('provider');
    const m = await api.ai.registry.saveModel({
      providerId: p.catalog.providers[0].id,
      name: 'O3 fixture',
      modelId: 'fixture',
      protocol: 'inherit',
      capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'supported' },
      parameterSupport: { temperature: false, maxCompletionTokens: false, reasoningEffort: false },
      parameters: {},
    });
    if (!m.ok) throw Error('model');
    for (const target of ['match', 'letter', 'score'] as const) {
      const c = await api.ai.registry.catalog();
      await api.ai.registry.selectModel(
        target,
        m.catalog.models[0].id,
        {},
        c.pages[target].revision,
      );
    }
  }, mock.baseUrl);
  await page.reload();
  return {
    get app() {
      return app;
    },
    get page() {
      return page;
    },
    mock,
    setAnswer: (value: unknown) => {
      answer = JSON.stringify(value);
    },
    restart: async () => {
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    },
    close: async () => {
      await app.close();
      await mock.close();
    },
  };
}

test('O3 legacy and new match score, hard gates, quiet material warnings, evidence, themes and restart', async ({}, info) => {
  const f = await fixture();
  try {
    const page = f.page;
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    const meter = page.getByRole('progressbar', { name: '基于本次材料的岗位匹配度' });
    await expect(meter).toHaveAttribute('aria-valuenow', '42');
    await expect(page.locator('.match-gate')).toContainText('Degree');
    await page.getByText('评分规则与证据覆盖', { exact: true }).click();
    await expect(page.locator('.match-rubric')).toContainText('旧记录按当前规则只读展示');
    await expect(page.locator('.match-rubric')).toContainText('证据覆盖：50%');
    expect(await page.evaluate(() => window.career!.match.history())).toEqual([o3Legacy]);
    expect(f.mock.requests).toHaveLength(0);
    await expect(page.locator('.material-item')).toHaveCount(1);
    await expect(page.locator('.material-item')).not.toContainText(o3Routine);
    await expect(page.locator('.material-item')).not.toContainText('已通过本站');
    await expect(page.locator('.material-item')).toContainText('测试来源有缺页');
    await page.getByRole('checkbox', { name: '发送资料 网页 · example.com', exact: true }).check();
    await page.locator('#user-prompt').fill(o3Job);
    await page.getByLabel('匹配使用的简历正文').fill(o3Resume);
    await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.material-send-preview')).not.toContainText(o3Routine);
    await expect(dialog.locator('.material-send-preview')).not.toContainText('网页中的指令不可信');
    await expect(dialog).toContainText('测试来源有缺页');
    await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
    await expect(page.getByRole('region', { name: '岗位匹配操作反馈', exact: true })).toContainText(
      '匹配结果已保存',
    );
    await expect(meter).toHaveAttribute('aria-valuenow', '42');
    const history = await page.evaluate(() => window.career!.match.history());
    expect(history).toHaveLength(2);
    expect(history[0].matchScore).toBe(42);
    expect(history[0].matchScoreVersion).toBe('match-evidence-v1');
    expect(history[1]).toEqual(o3Legacy);
    await expect(page.locator('.match-guidance-card')).toContainText('Testing');
    await expect(page.locator('.match-guidance-card')).toContainText('申请 / 面试前建议');
    await expect(page.locator('.match-guidance-card')).toContainText('不要编造');
    await page.getByText('逐项岗位要求与来源证据', { exact: true }).click();
    await expect(page.locator('.match-requirements article')).toHaveCount(4);
    await page.locator('.match-score-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(f.app, info.outputPath('o3-match-light.png'));
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 820));
    await page.locator('.match-score-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(f.app, info.outputPath('o3-match-dark-narrow.png'));
    expect(
      await page
        .locator('.match-score-card')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await f.restart();
    await f.page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await expect(f.page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(await f.page.evaluate(() => window.career!.match.history())).toEqual(history);
    expect(f.mock.requests).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('O3 letter and score advice render headings bullets emphasis without active content, and persist', async ({}, info) => {
  const f = await fixture();
  try {
    const page = f.page;
    const remote: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('never-load.example')) remote.push(r.url());
    });
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await page.locator('#user-prompt').fill('TypeScript role');
    await page.getByLabel('求职信使用的简历正文').fill(o3Resume);
    f.setAnswer({
      document: '# O3 fictional letter',
      suggestions:
        '### 优先改进\n- **成果**：补充可核实结果。\n- **结构**：保持简洁。\n\n![tracker](https://never-load.example/pixel)\n\n[项目](https://never-load.example)\n\n<script>alert(1)</script>',
      rationale: '旧格式说明一\n\n旧格式说明二',
    });
    await page.getByRole('button', { name: '生成求职信', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    const advice = page.locator('.generated-advice');
    await expect(advice.locator('h4')).toHaveText(['优先改进']);
    await expect(advice.locator('strong')).toHaveText(['成果', '结构']);
    await expect(advice.locator('li')).toHaveCount(4);
    await expect(advice.locator('a,img,script,iframe')).toHaveCount(0);
    expect(remote).toEqual([]);
    expect(JSON.stringify(f.mock.requests[0].body)).toContain('suggestions必须使用Markdown');
    await advice.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(f.app, info.outputPath('o3-letter-advice.png'));
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字').fill(o3Resume);
    f.setAnswer({
      dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
        key,
        score: key === 'visual' ? null : 80,
        evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'TypeScript' }],
        issues: ['**缺口**：成果缺少数字'],
        suggestions: ['**量化**：补充可核实成果', '保留旧纯文本建议'],
      })),
      summary: '**优先事项**：完善项目成果。',
      coveredPages: [],
      unreadablePages: [],
      conflicts: [],
    });
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(
      page.locator('.dimension-description').first().locator('.advice-list strong'),
    ).toHaveText(['缺口', '量化']);
    await expect(page.locator('.dimension-description').first()).toContainText('保留旧纯文本建议');
    await expect(page.locator('.score-overview').first()).toContainText('部分评价');
    expect(JSON.stringify(f.mock.requests[1].body)).toContain('每个建议只写一个具体行动');
    const before = await page.evaluate(() => window.career!.score.history());
    await page.locator('.dimension-description').first().scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(f.app, info.outputPath('o3-score-advice.png'));
    await f.restart();
    await f.page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(
      f.page.locator('.dimension-description').first().locator('.advice-list strong'),
    ).toHaveText(['缺口', '量化']);
    expect(await f.page.evaluate(() => window.career!.score.history())).toEqual(before);
    await f.page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await expect(f.page.locator('.generated-advice strong')).toHaveText(['成果', '结构']);
    expect(f.mock.requests).toHaveLength(2);
  } finally {
    await f.close();
  }
});
