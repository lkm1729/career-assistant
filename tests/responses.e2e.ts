import { revealConfirmation } from './confirmation-preview';
import {
  test,
  expect,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { responsesFixture } from './responses-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
const fakeKey = 'P05-LOCAL-FAKE-KEY';
async function fixture() {
  const mock = await responsesFixture();
  mkdirSync(resolve('.test-data'), { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/p05-'));
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
    ...mock,
    directory,
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
  };
}
async function configure(
  page: Page,
  baseUrl: string,
  providerProtocol = 'responses',
  parameters = false,
) {
  await page.getByRole('button', { name: '应用设置', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  await page.getByLabel('供应商名称', { exact: true }).fill('P05 本机服务');
  await page.getByLabel('默认接口协议', { exact: true }).selectOption(providerProtocol);
  await page.getByLabel('Base URL', { exact: true }).fill(baseUrl + '/responses');
  await expect(page.locator('.endpoint-preview')).toContainText(
    providerProtocol === 'responses' ? '/proxy/v1/responses' : '/proxy/v1/chat/completions',
  );
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: '保存供应商', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('供应商已保存');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID', { exact: true }).fill('p05-model');
  await page.getByLabel('模型显示名称', { exact: true }).fill('P05 模型');
  await expect(page.getByLabel('模型协议', { exact: true })).toHaveCount(0);
  await expect(page.locator('.endpoint-preview')).toContainText('/proxy/v1/responses');
  if (parameters) {
    await page.getByRole('checkbox', { name: '支持 temperature', exact: true }).check();
    await page.getByRole('checkbox', { name: '支持 max_output_tokens', exact: true }).check();
    await page.getByRole('checkbox', { name: '支持 reasoning.effort', exact: true }).check();
    await page.getByLabel('温度 · 模型默认', { exact: true }).fill('0.6');
    await page.getByLabel('输出上限 · 模型默认', { exact: true }).fill('4096');
    await page.getByLabel('推理强度 · 模型默认', { exact: true }).selectOption('medium');
  }
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('模型已保存');
}
async function select(page: Page) {
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page
    .getByRole('combobox', { name: '本页模型' })
    .selectOption({ label: 'P05 模型 / P05 本机服务' });
}
async function generate(page: Page, refine = false) {
  await page.getByRole('button', { name: refine ? '继续调整' : '生成简历', exact: true }).click();
  await revealConfirmation(page);
  await expect(page.getByRole('dialog', { name: '确认本次发送内容' })).toContainText(
    'store: false',
  );
  await page
    .getByRole('button', { name: refine ? '确认发送并调整' : '确认发送并生成', exact: true })
    .click();
}

test('P05 Responses: configure, isolated generation, parameters, refine, restore and reopen', async ({}, info) => {
  test.setTimeout(180000);
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    let launched = await f.launch();
    app = launched.app;
    let page = launched.page;
    await configure(page, f.baseUrl, 'responses', true);
    expect(f.requests).toHaveLength(0);
    await select(page);
    await page.getByRole('button', { name: '调整', exact: true }).click();
    await page.getByLabel('温度 · 本页覆盖', { exact: true }).fill('0.2');
    await page.getByRole('button', { name: '保存本页参数', exact: true }).click();
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await page.locator('#user-prompt').fill('P05-PRIVATE-OTHER-PAGE');
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await page.locator('#user-prompt').fill('真实经历：项目开发，请写简历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    const request = f.requests[0];
    expect(request.path).toBe('/proxy/v1/responses');
    expect(request.authorization).toBe('Bearer ' + fakeKey);
    expect(request.body.store).toBe(false);
    expect(request.body.temperature).toBe(0.2);
    expect(request.body.max_output_tokens).toBe(4096);
    expect(request.body.reasoning).toEqual({ effort: 'medium' });
    expect(JSON.stringify(request.body)).not.toContain('P05-PRIVATE-OTHER-PAGE');
    expect(request.body).not.toHaveProperty('previous_response_id');
    await page.getByLabel('修改要求', { exact: true }).fill('精简为一页');
    await generate(page, true);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
    expect(JSON.parse(f.requests[1].body.input[1].content[0].text)).toMatchObject({
      operation: 'refine',
      currentResume: '# P05 生成正文',
      request: '精简为一页',
    });
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await page.getByRole('button', { name: /^V1/ }).click();
    await expect(page.locator('.version-detail')).toContainText('OpenAI Responses');
    await page.getByRole('button', { name: '回滚到 V1', exact: true }).click();
    await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
    await expect(page.getByRole('button', { name: /^V1 · 当前/ })).toBeVisible();
    await captureWindow(app, info.outputPath('p05-responses-history.png'));
    expect(f.requests).toHaveLength(2);
    await page.keyboard.press('Escape');
    const history = await page.evaluate(() => window.career!.ai.listResumeVersions());
    expect(history[1].connection.protocol).toBe('responses');
    await app.close();
    app = undefined;
    launched = await f.launch();
    app = launched.app;
    page = launched.page;
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    await expect(page.locator('.page-parameter-summary')).toContainText('OpenAI Responses');
    expect(await page.evaluate(() => window.career!.ai.listResumeVersions())).toEqual(history);
    expect(f.requests).toHaveLength(2);
  } finally {
    await app?.close();
    await f.close();
  }
});

test('P05 Responses: provider inheritance, text/image probes, switching provider protocol invalidates receipts not history', async ({}, info) => {
  test.setTimeout(180000);
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    const launched = await f.launch();
    app = launched.app;
    const page = launched.page;
    await configure(page, f.baseUrl, 'responses');
    for (const [kind, label] of [
      ['text', '文本'],
      ['image', '图片'],
    ] as const) {
      const before = f.requests.length;
      await page
        .getByRole('button', {
          name: `${label === '文本' ? '测试模型连通性' : '测试图片'} · P05 模型`,
          exact: true,
        })
        .click();
      await expect(page.getByRole('region', { name: '测试发送确认' })).toContainText(
        'OpenAI Responses',
      );
      expect(f.requests).toHaveLength(before);
      await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
      await expect(page.locator('.test-records')).toContainText(`${label} · 已验证通过`);
      if (kind === 'text')
        await expect(page.locator('.test-records')).not.toContainText('图片 · 已验证通过');
    }
    expect(f.requests[1].body.input[0].content[1]).toMatchObject({
      type: 'input_image',
      detail: 'auto',
    });
    await captureWindow(app, info.outputPath('p05-responses-model.png'));
    await select(page);
    await page.locator('#user-prompt').fill('真实经历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    const original = (await page.evaluate(() => window.career!.ai.listResumeVersions()))[0];
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑供应商 P05 本机服务', exact: true }).click();
    await page.getByLabel('默认接口协议', { exact: true }).selectOption('chat-completions');
    await expect(page.locator('.endpoint-preview')).toContainText('/proxy/v1/chat/completions');
    await page.getByRole('button', { name: '保存供应商', exact: true }).click();
    await expect(page.locator('.test-records')).toContainText('已过期');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '生成简历', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('OpenAI Chat Completions');
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
    expect(f.requests.at(-1)?.path).toBe('/proxy/v1/chat/completions');
    const history = await page.evaluate(() => window.career!.ai.listResumeVersions());
    expect(history[0].connection.protocol).toBe('chat-completions');
    expect(history[1]).toEqual(original);
  } finally {
    await app?.close();
    await f.close();
  }
});

test('P05 Responses: cancel and incomplete/failed/refused/truncated outputs never publish a version', async () => {
  test.setTimeout(180000);
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    const launched = await f.launch();
    app = launched.app;
    const page = launched.page;
    await configure(page, f.baseUrl);
    await select(page);
    await page.locator('#user-prompt').fill('已有真实经历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    await page.getByLabel('修改要求', { exact: true }).fill('这条修改要求不能被失败请求消耗');
    for (const [mode, notice] of [
      ['slow', '已取消'],
      ['incomplete', 'AI_STREAM_INCOMPLETE'],
      ['failed', '返回错误'],
      ['refusal', '拒绝'],
      ['truncated', 'AI_STREAM_INCOMPLETE'],
      ['invalid', '模型未返回完整'],
      ['unauthorized', '认证失败'],
    ] as const) {
      f.setMode(mode);
      await generate(page, true);
      if (mode === 'slow') {
        await expect(page.locator('.stream-preview')).toContainText('Responses 内容');
        await page.getByRole('button', { name: '取消生成', exact: true }).click();
      }
      await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText(notice);
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
      await expect(page.getByLabel('修改要求', { exact: true })).toHaveValue(
        '这条修改要求不能被失败请求消耗',
      );
      expect(
        await page.evaluate(async () => (await window.career!.ai.listResumeVersions()).length),
      ).toBe(1);
      await expect(page.locator('body')).not.toContainText('PRIVATE-P05-ERROR-DO-NOT-DISPLAY');
    }
    f.setMode('success');
    await generate(page, true);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
  } finally {
    await app?.close();
    await f.close();
  }
});
