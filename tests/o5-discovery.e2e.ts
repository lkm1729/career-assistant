import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { seedO4 } from './o4-fixture';
import { protocols, type Protocol } from '../shared/ai';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
async function fixture(protocol: Protocol) {
  let status = 200;
  let hold = false;
  const requests: { url: string; method: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      requests.push({ url: req.url!, method: req.method!, body });
      if (hold) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      if (status !== 200) {
        res.end('{"error":"PRIVATE-KEY-BODY"}');
        return;
      }
      const url = new URL(req.url!, 'http://localhost');
      const next = url.searchParams.has(protocol === 'anthropic' ? 'after_id' : 'pageToken');
      const ids = next ? ['model-b', 'model-c'] : ['model-a', 'model-b', 'model-a'];
      res.end(
        JSON.stringify(
          protocol === 'gemini'
            ? {
                models: ids.map((id) => ({ name: 'models/' + id })),
                ...(next ? {} : { nextPageToken: 'next' }),
              }
            : protocol === 'anthropic'
              ? {
                  data: ids.map((id) => ({ id })),
                  has_more: !next,
                  last_id: next ? 'model-c' : 'model-b',
                }
              : { data: ids.map((id) => ({ id })) },
        ),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  mkdirSync('.test-data', { recursive: true });
  const data = mkdtempSync(resolve('.test-data/o5-e2e-'));
  seedO4(join(data, 'workspace.sqlite'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: data,
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
  await page.evaluate(
    async ({ baseUrl, protocol }) => {
      const r = await window.career!.ai.registry.saveProvider({
        name: 'O5 fixture',
        baseUrl,
        protocol,
        apiKey: 'FAKE-DISCOVERY',
      });
      if (!r.ok) throw Error(r.message);
    },
    { baseUrl: `http://127.0.0.1:${address.port}/v1`, protocol },
  );
  await page.reload();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  return {
    get app() {
      return app;
    },
    get page() {
      return page;
    },
    requests,
    setStatus: (v: number) => {
      status = v;
    },
    setHold: (v: boolean) => {
      hold = v;
    },
    async restart() {
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    },
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
for (const protocol of protocols)
  test(`O5 ${protocol}: consent, search, select/import, no automatic capability or selection`, async ({}, info) => {
    const f = await fixture(protocol);
    try {
      const page = f.page;
      const before = await page.evaluate(() => window.career!.load());
      await page.getByRole('button', { name: '应用设置', exact: true }).click();
      const region = page.getByRole('region', { name: '获取模型列表', exact: true });
      await region.getByRole('button', { name: '获取模型列表', exact: true }).click();
      expect(f.requests).toHaveLength(0);
      await region
        .getByRole('button', { name: '确认获取模型列表', exact: true })
        .evaluate((b: HTMLButtonElement) => {
          b.click();
          b.click();
        });
      await expect(region).toContainText('已获取 2 个');
      expect(f.requests).toHaveLength(1);
      await expect(region.getByLabel('导入模型 model-a', { exact: true })).not.toBeChecked();
      if (protocol === 'anthropic' || protocol === 'gemini') {
        await region.getByRole('button', { name: '获取下一页' }).click();
        await expect(region).toContainText('已获取 3 个');
        expect(f.requests).toHaveLength(2);
      }
      await region.getByLabel('搜索模型 ID', { exact: true }).fill('model-a');
      await region.getByLabel('全选搜索结果', { exact: true }).check();
      await region.getByRole('button', { name: '导入所选模型（1）', exact: true }).click();
      expect((await page.evaluate(() => window.career!.ai.registry.catalog())).models).toHaveLength(
        0,
      );
      await region.getByRole('button', { name: '取消导入', exact: true }).click();
      await region.getByRole('button', { name: '导入所选模型（1）', exact: true }).click();
      await region.getByRole('button', { name: '确认导入', exact: true }).click();
      await expect(region).toContainText('所选模型已导入');
      await expect(region.getByLabel('导入模型 model-a', { exact: true })).toBeDisabled();
      const catalog = await page.evaluate(() => window.career!.ai.registry.catalog());
      expect(catalog.models).toHaveLength(1);
      expect(catalog.models[0]).toMatchObject({
        modelId: 'model-a',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        tests: [],
      });
      expect(Object.values(catalog.pages).every((p) => p.modelId === null)).toBe(true);
      expect(f.requests.every((r) => r.method === 'GET' && r.body === '')).toBe(true);
      const after = await page.evaluate(() => window.career!.load());
      expect(after.workspaces).toEqual(before.workspaces);
      if (protocol === 'anthropic') {
        await region.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );
        await page.waitForTimeout(600);
        await captureWindow(f.app, info.outputPath('o5-discovery.png'));
        await f.restart();
        expect(
          (await f.page.evaluate(() => window.career!.ai.registry.catalog())).models,
        ).toHaveLength(1);
      }
      await expect(f.page.locator('body')).not.toContainText('FAKE-DISCOVERY');
    } finally {
      await f.close();
    }
  });
test('O5 real HTTP headline and safe details; cancellation unlocks controls without auto retry', async ({}, info) => {
  const f = await fixture('anthropic');
  try {
    await f.page.getByRole('button', { name: '应用设置', exact: true }).click();
    const region = f.page.getByRole('region', { name: '获取模型列表', exact: true });
    await region.getByRole('button', { name: '获取模型列表', exact: true }).click();
    for (const status of [401, 404, 429, 500, 502, 503]) {
      f.setStatus(status);
      await region.getByRole('button', { name: '确认获取模型列表', exact: true }).click();
      await expect(region.locator('.http-status')).toHaveText(`HTTP ${status}`);
      await expect(
        region.locator('code').filter({ hasText: `AI_HTTP_${status}` }),
      ).not.toBeVisible();
      await region.getByText('技术诊断详情', { exact: true }).click();
      await expect(region.locator('code').filter({ hasText: `AI_HTTP_${status}` })).toBeVisible();
      await expect(f.page.locator('body')).not.toContainText('PRIVATE-KEY-BODY');
      // Close details so the next diagnostic begins folded, like a fresh panel.
      await region.getByText('技术诊断详情', { exact: true }).click();
    }
    await region
      .locator('.http-status')
      .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await f.page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await f.page.waitForTimeout(600);
    await captureWindow(f.app, info.outputPath('o5-http-503.png'));
    f.setHold(true);
    await region.getByRole('button', { name: '确认获取模型列表', exact: true }).click();
    await expect.poll(() => f.requests.length).toBe(7);
    await expect(f.page.getByRole('button', { name: '添加模型', exact: true })).toBeDisabled();
    await region.getByRole('button', { name: '取消获取模型列表', exact: true }).click();
    await expect(region.getByRole('alert')).toContainText('已取消获取模型列表');
    await expect(region.locator('.http-status')).toHaveCount(0);
    await expect(
      region.getByRole('button', { name: '确认获取模型列表', exact: true }),
    ).toBeEnabled();
    expect(f.requests).toHaveLength(7);
  } finally {
    await f.close();
  }
});
