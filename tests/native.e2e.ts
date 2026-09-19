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
import { nativeFixture, type NativeProtocol } from './native-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
const label = (protocol: NativeProtocol) =>
  protocol === 'gemini' ? 'Gemini 原生协议' : 'Anthropic Messages';
async function fixture(protocol: NativeProtocol) {
  const mock = await nativeFixture();
  mkdirSync(resolve('.test-data'), { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/' + protocol + '-'));
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
async function configure(page: Page, protocol: NativeProtocol, baseUrl: string) {
  await page.getByRole('button', { name: '应用设置', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  await page.getByLabel('供应商名称', { exact: true }).fill('原生模拟供应商');
  await page.getByLabel('默认接口协议', { exact: true }).selectOption(protocol);
  await page.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill('E2E-NATIVE-FAKE');
  await page.getByRole('button', { name: '保存供应商', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('供应商已保存');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID', { exact: true }).fill('native-model');
  await page.getByLabel('模型显示名称', { exact: true }).fill('原生模型');
  await expect(page.getByLabel('模型协议', { exact: true })).toHaveCount(0);
  await expect(page.locator('.endpoint-preview')).toContainText(
    protocol === 'gemini' ? '/models/native-model:streamGenerateContent?alt=sse' : '/messages',
  );
  await page.getByRole('checkbox', { name: '支持 temperature', exact: true }).check();
  await page.getByLabel('温度 · 模型默认', { exact: true }).fill('0.4');
  if (protocol === 'gemini') {
    await page.getByRole('checkbox', { name: '支持 maxOutputTokens', exact: true }).check();
    await page.getByLabel('输出上限 · 模型默认', { exact: true }).fill('4096');
  } else {
    await expect(page.getByRole('dialog')).toContainText('未覆盖时使用 4096');
    await expect(
      page.getByRole('checkbox', { name: '覆盖 max_tokens', exact: true }),
    ).not.toBeChecked();
  }
  await expect(
    page.getByRole('checkbox', { name: '支持 reasoning_effort', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('模型已保存');
}
async function select(page: Page) {
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page
    .getByRole('combobox', { name: '本页模型' })
    .selectOption({ label: '原生模型 / 原生模拟供应商' });
}
async function generate(page: Page, protocol: NativeProtocol, refine = false) {
  await page.getByRole('button', { name: refine ? '继续调整' : '生成简历', exact: true }).click();
  await revealConfirmation(page);
  await expect(page.getByRole('dialog', { name: '确认本次发送内容' })).toContainText(
    label(protocol),
  );
  await expect(page.getByRole('dialog')).toContainText(
    protocol === 'gemini' ? 'generationConfig' : 'max_tokens',
  );
  await page
    .getByRole('button', { name: refine ? '确认发送并调整' : '确认发送并生成', exact: true })
    .click();
}
for (const protocol of ['gemini', 'anthropic'] as const) {
  test(
    protocol +
      ': native configuration, independent probes, overrides, generation/refinement/restore and reopen',
    async ({}, info) => {
      test.setTimeout(180000);
      const f = await fixture(protocol);
      let app: ElectronApplication | undefined;
      try {
        let launched = await f.launch();
        app = launched.app;
        let page = launched.page;
        await configure(page, protocol, f.baseUrl(protocol));
        expect(f.requests).toHaveLength(0);
        for (const kind of ['文本', '图片']) {
          await page
            .getByRole('button', {
              name: (kind === '文本' ? '测试模型连通性' : '测试图片') + ' · 原生模型',
              exact: true,
            })
            .click();
          await expect(page.getByRole('region', { name: '测试发送确认' })).toContainText(
            label(protocol),
          );
          const count = f.requests.length;
          await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
          await expect(page.locator('.test-records')).toContainText(kind + ' · 已验证通过');
          expect(f.requests).toHaveLength(count + 1);
        }
        await select(page);
        await page.getByRole('button', { name: '调整', exact: true }).click();
        await page.getByLabel('温度 · 本页覆盖', { exact: true }).fill('0.2');
        await page.getByRole('button', { name: '保存本页参数', exact: true }).click();
        await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
        await page.locator('#user-prompt').fill('OTHER-PAGE-PRIVATE-NATIVE');
        await page.getByRole('button', { name: '设计简历', exact: true }).click();
        await page.locator('#user-prompt').fill('真实经历：软件项目开发');
        await generate(page, protocol);
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
        const request = f.requests[2];
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers[protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key']).toBe(
          'E2E-NATIVE-FAKE',
        );
        expect(JSON.stringify(request.body)).not.toContain('OTHER-PAGE-PRIVATE-NATIVE');
        if (protocol === 'gemini') {
          expect(request.body.generationConfig).toMatchObject({
            temperature: 0.2,
            maxOutputTokens: 4096,
          });
          expect(request.body.systemInstruction).toBeDefined();
        } else {
          expect(request.body.temperature).toBe(0.2);
          expect(request.body.max_tokens).toBe(4096);
          expect(request.body.system).toBeDefined();
        }
        await page.getByLabel('修改要求', { exact: true }).fill('精简为一页');
        await generate(page, protocol, true);
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
        await page.getByRole('button', { name: '本页记录', exact: true }).click();
        await page.getByRole('button', { name: /^V1/ }).click();
        await expect(page.locator('.version-detail')).toContainText(label(protocol));
        expect(
          (await page.evaluate(() => window.career!.load())).workspaces.resume.currentVersionNumber,
        ).toBe(2);
        await page.getByRole('button', { name: '回滚到 V1', exact: true }).click();
        await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
        await expect(page.getByRole('button', { name: /^V1 · 当前/ })).toBeVisible();
        await captureWindow(app, info.outputPath(protocol + '-history.png'));
        expect(f.requests).toHaveLength(4);
        const history = await page.evaluate(() => window.career!.ai.listResumeVersions());
        await page.keyboard.press('Escape');
        await app.close();
        app = undefined;
        launched = await f.launch();
        app = launched.app;
        page = launched.page;
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
        expect(await page.evaluate(() => window.career!.ai.listResumeVersions())).toEqual(history);
        expect(f.requests).toHaveLength(4);
      } finally {
        await app?.close();
        await f.close();
      }
    },
  );
  test(
    protocol +
      ': explicit model protocol, cancellation and failures preserve history; changing protocol expires probes',
    async () => {
      test.setTimeout(180000);
      const f = await fixture(protocol);
      let app: ElectronApplication | undefined;
      try {
        const launched = await f.launch();
        app = launched.app;
        const page = launched.page;
        await configure(page, protocol, f.baseUrl(protocol));
        await page.getByRole('button', { name: '测试模型连通性 · 原生模型', exact: true }).click();
        await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
        await expect(page.locator('.test-records')).toContainText('文本 · 已验证通过');
        await select(page);
        await page.locator('#user-prompt').fill('已有真实经历');
        await generate(page, protocol);
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
        await page.getByLabel('修改要求', { exact: true }).fill('失败后仍须保留修改要求');
        for (const mode of [
          'slow',
          'incomplete',
          'failed',
          'refusal',
          'truncated',
          'invalid',
          'unauthorized',
        ] as const) {
          f.setMode(mode);
          await generate(page, protocol, true);
          if (mode === 'slow') {
            await expect(page.locator('.stream-preview')).toContainText('原生协议内容');
            await page.getByRole('button', { name: '取消生成', exact: true }).click();
          }
          await expect(page.getByRole('button', { name: '继续调整', exact: true })).toBeEnabled();
          await expect(page.getByRole('region', { name: '简历生成状态' })).not.toContainText(
            '已保存',
          );
          await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
          await expect(page.getByLabel('修改要求', { exact: true })).toHaveValue(
            '失败后仍须保留修改要求',
          );
          expect(
            await page.evaluate(async () => (await window.career!.ai.listResumeVersions()).length),
          ).toBe(1);
          await expect(page.locator('body')).not.toContainText('PRIVATE-NATIVE-ERROR');
        }
        const before = await page.evaluate(() => window.career!.ai.listResumeVersions());
        await page.getByRole('button', { name: '应用设置', exact: true }).click();
        await page.getByRole('button', { name: '编辑模型 原生模型', exact: true }).click();
        await page.getByLabel('模型显示名称', { exact: true }).fill('原生模型（已编辑）');
        await page.getByRole('button', { name: '保存模型', exact: true }).click();
        await expect(page.locator('.test-records')).toContainText('已过期');
        expect(await page.evaluate(() => window.career!.ai.listResumeVersions())).toEqual(before);
      } finally {
        await app?.close();
        await f.close();
      }
    },
  );
}
