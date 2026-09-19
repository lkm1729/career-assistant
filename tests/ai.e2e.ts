import { revealConfirmation } from './confirmation-preview';
import { captureWindow } from './capture-window';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fakeKey = 'LOCAL-TEST-KEY-P02-NOT-A-REAL-CREDENTIAL';
async function setup() {
  let mode: 'success' | 'slow' | 'unauthorized' | 'invalid' = 'success';
  const requests: { body: Record<string, unknown>; authorization: string | undefined }[] = [];
  let waiting: ServerResponse | null = null;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (data) => {
      raw += data;
    });
    request.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ body, authorization: request.headers.authorization });
      if (mode === 'unauthorized') {
        response.writeHead(401);
        response.end(fakeKey + ' private provider error');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const text =
        (body.messages as { content: string }[])[0].content === 'Reply with only OK.'
          ? 'OK'
          : mode === 'invalid'
            ? 'bad format'
            : JSON.stringify({
                document: raw.includes('refine')
                  ? '# 调整后的测试简历\n\n精简并突出项目成果。'
                  : '# 测试简历\n\n真实的项目经历。',
                suggestions: '保持足够留白。',
                rationale: '突出用户提供的真实经历。',
              });
      const send = (content: string) =>
        response.write(
          'data: ' +
            JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }) +
            '\n\n',
        );
      if (mode === 'slow') {
        waiting = response;
        send('尚未完成的流式内容');
        return;
      }
      send(text.slice(0, 12));
      send(text.slice(12));
      response.end(
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  mkdirSync(resolve('.test-data'), { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/p02-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const launch = async () => {
    const app = await electron.launch({
      executablePath: require('electron'),
      args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    return { app, page };
  };
  return {
    launch,
    baseUrl,
    directory,
    requests,
    setMode: (value: typeof mode) => {
      mode = value;
    },
    close: async () => {
      waiting?.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
async function configure(page: Page, baseUrl: string) {
  await page.getByRole('button', { name: '应用设置', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  await page.getByLabel('供应商名称', { exact: true }).fill('本机模拟服务');
  await page.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: '保存供应商', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('供应商已保存，密钥已加密');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID', { exact: true }).fill('mock-model');
  await page.getByLabel('模型显示名称', { exact: true }).fill('模拟模型');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('模型已保存');
}
async function generate(page: Page) {
  await page.getByRole('button', { name: '生成简历', exact: true }).click();
  await revealConfirmation(page);
  await expect(page.getByRole('dialog', { name: '确认本次发送内容' })).toBeVisible();
  await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
}
test('configure, explicitly test, generate V1, reopen and inspect an immutable version', async ({}, testInfo) => {
  const fixture = await setup();
  let app: ElectronApplication | undefined;
  try {
    let launched = await fixture.launch();
    app = launched.app;
    let page = launched.page;
    await configure(page, fixture.baseUrl);
    expect(fixture.requests).toHaveLength(0);
    await page.getByRole('button', { name: '测试模型连通性 · 模拟模型', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('可能产生费用');
    expect(fixture.requests).toHaveLength(0);
    await page.getByRole('button', { name: '确认发送测试', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('文本流式测试通过');
    expect(fixture.requests).toHaveLength(1);
    await captureWindow(app, testInfo.outputPath('p02-settings.png'));
    await page.getByRole('button', { name: '完成', exact: true }).click();
    if (
      await page
        .getByRole('combobox', { name: '本页模型' })
        .locator('option')
        .filter({ hasText: '模拟模型 / 本机模拟服务' })
        .count()
    )
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: '模拟模型 / 本机模拟服务' });
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await page.locator('#user-prompt').fill('NEVER-SEND-LETTER-DATA');
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await page.locator('#user-prompt').fill('我有两年项目经历，请设计简历。');
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await page.getByRole('textbox', { name: '正文草稿' }).fill('保留此生成前草稿');
    await page.getByRole('button', { name: '生成简历', exact: true }).click();
    await revealConfirmation(page);
    await expect(page.getByRole('dialog')).toContainText('我有两年项目经历');
    expect(fixture.requests).toHaveLength(1);
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText(
      '已保存正式版本 V1',
    );
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1].authorization).toBe(`Bearer ${fakeKey}`);
    expect(JSON.stringify(fixture.requests[1].body)).not.toContain('NEVER-SEND-LETTER-DATA');
    await expect(page.getByRole('textbox', { name: '正文草稿' })).toHaveValue(
      '# 测试简历\n\n真实的项目经历。',
    );
    await page.getByRole('button', { name: '阅读预览', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await captureWindow(app, testInfo.outputPath('p02-generated.png'));
    await app.close();
    app = undefined;
    launched = await fixture.launch();
    app = launched.app;
    page = launched.page;
    await expect(
      page.getByRole('combobox', { name: '本页模型' }).locator('option:checked'),
    ).toHaveText('模拟模型 / 本机模拟服务');
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await page.getByRole('button', { name: /^V1/ }).click();
    await expect(page.locator('.version-detail')).toContainText('测试简历');
    await page.getByText('查看本次输入快照（含生成前正文）', { exact: true }).click();
    await expect(page.locator('.version-detail')).toContainText('保留此生成前草稿');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await page.getByRole('button', { name: '删除供应商 本机模拟服务', exact: true }).click();
    await page.getByRole('button', { name: '确认删除所选配置', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('草稿和历史版本保持不变');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    if (
      await page
        .getByRole('combobox', { name: '本页模型' })
        .locator('option')
        .filter({ hasText: '模拟模型 / 本机模拟服务' })
        .count()
    )
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: '模拟模型 / 本机模拟服务' });
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await expect(page.getByRole('button', { name: /^V1/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await app.close();
    app = undefined;
    expect(
      readFileSync(join(fixture.directory, 'workspace.sqlite')).includes(Buffer.from(fakeKey)),
    ).toBe(false);
  } finally {
    await app?.close();
    await fixture.close();
  }
});
test('cancel, auth error and invalid structured output preserve previous text without versions', async () => {
  const fixture = await setup();
  let app: ElectronApplication | undefined;
  try {
    const launched = await fixture.launch();
    app = launched.app;
    const page = launched.page;
    await configure(page, fixture.baseUrl);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    if (
      await page
        .getByRole('combobox', { name: '本页模型' })
        .locator('option')
        .filter({ hasText: '模拟模型 / 本机模拟服务' })
        .count()
    )
      await page
        .getByRole('combobox', { name: '本页模型' })
        .selectOption({ label: '模拟模型 / 本机模拟服务' });
    await page.locator('#user-prompt').fill('请基于真实经历生成');
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await page.getByRole('textbox', { name: '正文草稿' }).fill('原有正文');
    fixture.setMode('slow');
    await generate(page);
    await expect(page.locator('.stream-preview')).toContainText('尚未完成');
    await expect(page.getByRole('textbox', { name: '正文草稿' })).toBeDisabled();
    await page.getByRole('button', { name: '取消生成', exact: true }).click();
    await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText('已取消');
    for (const mode of ['unauthorized', 'invalid'] as const) {
      fixture.setMode(mode);
      await generate(page);
      await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText(
        mode === 'unauthorized' ? '认证失败' : '模型未返回完整',
      );
      await expect(page.getByRole('textbox', { name: '正文草稿' })).toHaveValue('原有正文');
      await expect(page.locator('body')).not.toContainText(fakeKey);
    }
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('没有正式版本');
    await page.keyboard.press('Escape');
  } finally {
    await app?.close();
    await fixture.close();
  }
});

async function selectConfiguredModel(page: Page, baseUrl: string) {
  await configure(page, baseUrl);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page
    .getByRole('combobox', { name: '本页模型' })
    .selectOption({ label: '模拟模型 / 本机模拟服务' });
}
async function refine(page: Page) {
  await page.getByRole('button', { name: '继续调整', exact: true }).click();
  await revealConfirmation(page);
  await expect(page.getByRole('dialog', { name: '确认本次发送内容' })).toContainText(
    '本次修改要求',
  );
  await page.getByRole('button', { name: '确认发送并调整', exact: true }).click();
}

test('P04: refine V1 to V2, preview without changes, restore with confirmation, preserve manual edits and reopen', async ({}, testInfo) => {
  const fixture = await setup();
  let app: ElectronApplication | undefined;
  try {
    let launched = await fixture.launch();
    app = launched.app;
    let page = launched.page;
    await selectConfiguredModel(page, fixture.baseUrl);
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await page.locator('#user-prompt').fill('PRIVATE-LETTER-P04');
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await page.locator('#user-prompt').fill('真实背景：独立完成项目，请生成简历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    const first = await page.evaluate(
      async () => (await window.career!.ai.listResumeVersions())[0],
    );
    await page
      .getByLabel('修改要求', { exact: true })
      .fill('精简到一页，突出已有项目成果，不编造数据');
    await refine(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
    await expect(page.getByLabel('修改要求', { exact: true })).toHaveValue('');
    const body = fixture.requests[1].body as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1].content)).toEqual({
      operation: 'refine',
      background: '真实背景：独立完成项目，请生成简历',
      currentResume: first.document,
      request: '精简到一页，突出已有项目成果，不编造数据',
    });
    expect(JSON.stringify(fixture.requests)).not.toContain('PRIVATE-LETTER-P04');
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await page.getByRole('button', { name: /^V2/ }).click();
    await expect(page.locator('.version-lineage')).toContainText('前一正式版本 V1');
    await page.getByText('查看本次输入快照（含生成前正文）', { exact: true }).click();
    await expect(page.locator('.version-detail')).toContainText(
      '精简到一页，突出已有项目成果，不编造数据',
    );
    await page.getByRole('button', { name: /^V1/ }).click();
    expect(
      (await page.evaluate(() => window.career!.load())).workspaces.resume.currentVersionNumber,
    ).toBe(2);
    await page.getByRole('button', { name: '回滚到 V1', exact: true }).click();
    await expect(page.getByRole('region', { name: '确认回滚版本' })).toBeVisible();
    await page.getByRole('button', { name: '取消回滚', exact: true }).click();
    expect(
      await page.evaluate(async () => (await window.career!.ai.listResumeVersions()).length),
    ).toBe(2);
    await page.getByRole('button', { name: '回滚到 V1', exact: true }).click();
    await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
    await expect(page.getByRole('button', { name: /^V1 · 当前/ })).toBeVisible();
    await page.getByRole('button', { name: /^V1 · 当前/ }).click();
    await expect(page.locator('.version-lineage')).toContainText('基于本地草稿');
    await captureWindow(app, testInfo.outputPath('p04-history.png'));
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    expect(fixture.requests).toHaveLength(2);
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await page
      .getByRole('textbox', { name: '正文草稿' })
      .fill('手工补充内容，恢复时也必须保留快照');
    await page.getByLabel('修改要求', { exact: true }).fill('暂未发送的修改要求');
    await expect(page.getByLabel('当前正文版本')).toContainText('编辑稿 · 基于 V1');
    await expect(page.locator('.generated-advice')).toContainText('尚无对应的正式版本建议');
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await page.getByRole('button', { name: /^V2/ }).click();
    await page.getByRole('button', { name: '回滚到 V2', exact: true }).click();
    await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
    await expect(page.getByRole('button', { name: /^V2 · 当前/ })).toBeVisible();
    const history = await page.evaluate(() => window.career!.ai.listResumeVersions());
    expect(history).toHaveLength(2);
    const checkpoints = (await page.evaluate(() => window.career!.ai.getHistory('resume')))
      .checkpoints;
    expect(checkpoints[0].draft.document).toBe('手工补充内容，恢复时也必须保留快照');
    expect(checkpoints[0].draft.refinement).toBe('暂未发送的修改要求');
    expect(history[1]).toEqual(first);
    await page.keyboard.press('Escape');
    await app.close();
    app = undefined;
    launched = await fixture.launch();
    app = launched.app;
    page = launched.page;
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
    expect(await page.evaluate(() => window.career!.ai.listResumeVersions())).toEqual(history);
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await expect(page.locator('#user-prompt')).toHaveValue('PRIVATE-LETTER-P04');
  } finally {
    await app?.close();
    await fixture.close();
  }
});

test('P04: cancelled or failed refinement preserves the original version and pending instruction', async () => {
  const fixture = await setup();
  let app: ElectronApplication | undefined;
  try {
    const launched = await fixture.launch();
    app = launched.app;
    const page = launched.page;
    await selectConfiguredModel(page, fixture.baseUrl);
    await page.locator('#user-prompt').fill('真实经历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    await page.getByLabel('修改要求', { exact: true }).fill('不要丢失这条修改要求');
    for (const mode of ['slow', 'unauthorized', 'invalid'] as const) {
      fixture.setMode(mode);
      await refine(page);
      if (mode === 'slow') {
        await expect(page.locator('.stream-preview')).toContainText('尚未完成');
        await expect(page.getByLabel('修改要求', { exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '取消生成', exact: true }).click();
      }
      await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText(
        mode === 'slow' ? '已取消' : mode === 'unauthorized' ? '认证失败' : '模型未返回完整',
      );
      await expect(page.getByLabel('修改要求', { exact: true })).toHaveValue(
        '不要丢失这条修改要求',
      );
      await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
      expect(
        await page.evaluate(async () => (await window.career!.ai.listResumeVersions()).length),
      ).toBe(1);
      await expect(page.locator('body')).not.toContainText(fakeKey);
    }
    fixture.setMode('success');
    await refine(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V2');
  } finally {
    await app?.close();
    await fixture.close();
  }
});

test('P04: stale restore confirmation refuses to overwrite a newer saved draft', async () => {
  const fixture = await setup();
  let app: ElectronApplication | undefined;
  try {
    const launched = await fixture.launch();
    app = launched.app;
    const page = launched.page;
    await selectConfiguredModel(page, fixture.baseUrl);
    await page.locator('#user-prompt').fill('真实经历');
    await generate(page);
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    await page.getByRole('button', { name: '本页记录', exact: true }).click();
    await page.getByRole('button', { name: /^V1/ }).click();
    await page.getByRole('button', { name: '回滚到 V1', exact: true }).click();
    await expect(page.getByRole('region', { name: '确认回滚版本' })).toBeVisible();
    await page.evaluate(async () => {
      const draft = (await window.career!.load()).workspaces.resume;
      await window.career!.saveWorkspace('resume', {
        ...draft,
        document: '确认之后的新内容',
        currentVersionNumber: null,
      });
    });
    await page.getByRole('button', { name: '确认回滚，不创建新版本', exact: true }).click();
    await expect(page.getByRole('region', { name: '确认回滚版本' })).toHaveCount(0);
    expect(
      await page.evaluate(async () => (await window.career!.load()).workspaces.resume.document),
    ).toBe('确认之后的新内容');
    expect(
      await page.evaluate(async () => (await window.career!.ai.listResumeVersions()).length),
    ).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '简历生成状态' })).toContainText('确认后已改变');
    expect(fixture.requests).toHaveLength(1);
  } finally {
    await app?.close();
    await fixture.close();
  }
});
