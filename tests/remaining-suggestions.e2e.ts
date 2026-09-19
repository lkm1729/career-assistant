import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
async function fixture() {
  let status = 200,
    slow = false,
    sequence = 0;
  let release: (() => void) | null = null;
  const requests: { method: string; body: string }[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      requests.push({ method: request.method!, body: raw });
      if (status !== 200) {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end('{"error":"PRIVATE-DO-NOT-DISPLAY"}');
        return;
      }
      if (request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"data":[]}');
        return;
      }
      const body = JSON.parse(raw);
      const content =
        body.messages[0].content === 'Reply with only OK.'
          ? 'OK'
          : JSON.stringify({
              document: `# ${raw.includes('currentLetter') ? 'Letter' : 'Resume'} output ${++sequence}`,
              suggestions: 'Verified suggestions',
              rationale: 'Verified rationale',
            });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const finish = () =>
        response.end(
          'data: ' +
            JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) +
            '\n\ndata: [DONE]\n\n',
        );
      if (slow) {
        response.write(': waiting\n\n');
        release = finish;
      } else finish();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  mkdirSync('.test-data', { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/remaining-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  return {
    directory,
    requests,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    setStatus: (s: number) => (status = s),
    setSlow: (s: boolean) => (slow = s),
    release: () => {
      release?.();
      release = null;
    },
    launch: async () => {
      const app = await electron.launch({
        executablePath: require('electron'),
        args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
        env,
      });
      const page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
      return { app, page };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function provider(page: Page, baseUrl: string) {
  await page.getByRole('button', { name: '应用设置', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  await page.getByLabel('供应商名称', { exact: true }).fill('Regression Provider');
  await page.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill('FAKE-REGRESSION-KEY');
  await page.getByRole('button', { name: '保存供应商', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('供应商已保存');
}
async function model(page: Page) {
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID', { exact: true }).fill('fixture');
  await page.getByLabel('模型显示名称', { exact: true }).fill('Regression Model');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('模型已保存');
}

test('provider probe works without models, requires consent, persists, and failures have red diagnostic codes', async ({}, info) => {
  const f = await fixture();
  let launched = await f.launch();
  let app = launched.app;
  let page = launched.page;
  try {
    await provider(page, f.baseUrl);
    expect(f.requests).toHaveLength(0);
    await page
      .getByRole('button', { name: '测试供应商连通性 · Regression Provider', exact: true })
      .click();
    await expect(page.getByLabel('供应商探针确认')).toContainText('/v1/models');
    expect(f.requests).toHaveLength(0);
    await page.getByRole('button', { name: '确认测试供应商', exact: true }).click();
    await expect(page.getByLabel('供应商连通性')).toContainText('供应商探针已通过');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].method).toBe('GET');
    expect(f.requests[0].body).toBe('');
    f.setStatus(401);
    await page
      .getByRole('button', { name: '测试供应商连通性 · Regression Provider', exact: true })
      .click();
    await page.getByRole('button', { name: '确认测试供应商', exact: true }).click();
    const error = page.getByLabel('供应商连通性').getByRole('alert');
    await expect(error).toContainText('AI_HTTP_401');
    await expect(error).toContainText('可能原因');
    await expect(error).toContainText('建议解决办法');
    await page.getByRole('dialog').getByRole('button', { name: '浅色', exact: true }).click();
    await expect(error).toHaveCSS('color', 'rgb(198, 40, 40)');
    await expect(page.locator('body')).not.toContainText('PRIVATE-DO-NOT-DISPLAY');
    await captureWindow(app, info.outputPath('provider-error.png'));
    await model(page);
    await page
      .getByRole('button', { name: '测试模型连通性 · Regression Model', exact: true })
      .click();
    await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
    await expect(page.locator('.test-records')).toContainText('AI_HTTP_401');
    await app.close();
    launched = await f.launch();
    app = launched.app;
    page = launched.page;
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByLabel('供应商连通性')).toContainText('AI_HTTP_401');
    await expect(page.locator('.test-records')).toContainText('AI_HTTP_401');
  } finally {
    await app.close();
    await f.close();
  }
});
for (const documentPage of ['resume', 'letter'] as const)
  test(`${documentPage}: editable old version switching, rollback, draft recovery and batch trash survive reopening without extra versions`, async ({}, info) => {
    test.setTimeout(180000);
    const f = await fixture();
    let launched = await f.launch();
    let app = launched.app;
    let page = launched.page;
    try {
      await provider(page, f.baseUrl);
      await model(page);
      await page.getByRole('button', { name: '完成', exact: true }).click();
      const label = documentPage === 'resume' ? '简历' : '求职信';
      if (documentPage === 'letter')
        await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: 'Regression Model / Regression Provider' });
      await page.locator('#user-prompt').fill(`${label} ONLY PRIVATE FACTS`);
      const action = documentPage === 'resume' ? '生成简历' : '生成求职信';
      for (let number = 1; number <= 3; number++) {
        if (number === 1) f.setSlow(true);
        await page.getByRole('button', { name: action, exact: true }).click();
        await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
        if (number === 1) {
          await expect(page.getByLabel(`${label}生成状态`).locator('.ai-thinking')).toHaveCSS(
            'animation-name',
            'shimmer',
          );
          await expect(page.getByLabel(`${label}生成状态`)).toContainText(`正在起草${label}`);
          f.release();
          f.setSlow(false);
        }
        await expect(page.getByLabel('当前正文版本')).toHaveText(`正式版本 V${number}`);
      }
      const before = await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage);
      expect(before.versions).toHaveLength(3);
      await page.getByLabel('切换工作版本').selectOption('1');
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
      expect(
        (await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage)).versions,
      ).toEqual(before.versions);
      await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
      await page.getByRole('textbox', { name: '正文草稿' }).fill('MANUAL-EDIT-TO-RECOVER');
      await expect(page.getByLabel('当前正文版本')).toContainText('编辑稿');
      await page.getByRole('button', { name: '回滚', exact: true }).click();
      await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('未创建新版本');
      await page.getByLabel('选择版本 V2', { exact: true }).check();
      await page.getByLabel('选择版本 V3', { exact: true }).check();
      await expect(page.getByLabel('选择版本 V1', { exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '删除所选版本 (2)', exact: true }).click();
      await page.getByRole('button', { name: '确认移入回收站', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage)).versions
              .length,
        )
        .toBe(1);
      await page.getByRole('button', { name: '回收站 (2)', exact: true }).click();
      await page.getByLabel('全选可操作版本', { exact: true }).check();
      await page.getByRole('button', { name: '恢复所选版本 (2)', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage)).versions
              .length,
        )
        .toBe(3);
      await page.getByRole('button', { name: /^切换前草稿/ }).click();
      await page.locator('.checkpoint-row').first().click();
      await expect(page.getByLabel('恢复草稿备份')).toContainText('MANUAL-EDIT-TO-RECOVER');
      await page.getByRole('button', { name: '确认恢复草稿备份', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('已恢复所选草稿备份');
      await page.getByRole('button', { name: '返回工作区', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '正文草稿' })).toHaveValue(
        'MANUAL-EDIT-TO-RECOVER',
      );
      await page.getByLabel('修改要求', { exact: true }).fill('Refine from V1');
      await page.getByRole('button', { name: '继续调整', exact: true }).click();
      await page.getByRole('button', { name: '确认发送并调整', exact: true }).click();
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V4');
      const history = await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage);
      expect(history.versions[0].parentNumber).toBe(1);
      expect(history.versions).toHaveLength(4);
      expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(4);
      const other: 'letter' | 'resume' = documentPage === 'resume' ? 'letter' : 'resume';
      expect(
        (await page.evaluate((p: 'letter' | 'resume') => window.career!.ai.getHistory(p), other))
          .versions,
      ).toHaveLength(0);
      await captureWindow(app, info.outputPath(documentPage + '-versions.png'));
      await app.close();
      launched = await f.launch();
      app = launched.app;
      page = launched.page;
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V4');
      expect(
        (await page.evaluate((p) => window.career!.ai.getHistory(p), documentPage)).versions,
      ).toEqual(history.versions);
    } finally {
      await app.close();
      await f.close();
    }
  });
