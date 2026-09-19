import { responsesFixture } from './responses-fixture';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
function dataDir() {
  mkdirSync('.test-data', { recursive: true });
  return mkdtempSync(resolve('.test-data/o1-desktop-'));
}
async function launch(dir: string) {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
    env,
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return { app, page };
}
async function pick(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths,
    })) as typeof dialog.showOpenDialog;
  }, paths);
}

test('O1 mixed file queue, independent sending/removal selections, cancel, cross-page isolation and reopen', async ({}, info) => {
  const dir = dataDir();
  const paths = ['cv.txt', 'job.txt', 'project.txt'].map((name) => join(dir, name));
  paths.forEach((path) =>
    writeFileSync(path, 'Fictional local source: ' + path.split(/[\\/]/).at(-1)),
  );
  let { app, page } = await launch(dir);
  try {
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await pick(app, paths);
    await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
    await expect(page.getByRole('region', { name: '逐项设置文件用途' })).toBeVisible();
    expect(await page.evaluate(() => window.career!.materials.list('match'))).toHaveLength(0);
    await page.getByLabel('第2个文件用途', { exact: true }).selectOption('job');
    await page.getByLabel('第3个文件用途', { exact: true }).selectOption('evidence');
    await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(3);
    for (const name of ['cv.txt', 'job.txt', 'project.txt'])
      await expect(page.getByRole('checkbox', { name: '发送资料 ' + name })).not.toBeChecked();
    await expect(page.getByLabel('资料用途 job.txt', { exact: true })).toHaveValue('job');
    await expect(page.getByLabel('资料用途 project.txt', { exact: true })).toHaveValue('evidence');
    await page.getByRole('checkbox', { name: '发送资料 cv.txt' }).check();
    const before = await page.evaluate(() => window.career!.materials.manifest('match', false));
    await page.getByLabel('资料用途 cv.txt', { exact: true }).selectOption('evidence');
    await expect(page.getByLabel('资料用途 cv.txt', { exact: true })).toHaveValue('evidence');
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.career!.materials.manifest('match', false))).revision,
      )
      .not.toBe(before.revision);
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择移除 project.txt', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: '发送资料 cv.txt' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '发送资料 project.txt' })).not.toBeChecked();
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: '确认移除资料' });
    await expect(confirm).toContainText('project.txt');
    await expect(confirm).not.toContainText('cv.txt');
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(3);
    await page.locator('.material-batch-toolbar').scrollIntoViewIfNeeded();
    await captureWindow(app, info.outputPath('o1-materials-light.png'));
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.material-batch-toolbar').scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(app, info.outputPath('o1-materials-dark.png'));
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(0);
    const fallback = await page.evaluate(() =>
      window.career!.materials.importText('resume', 'evidence', {
        title: 'Isolated project',
        text: 'Separate resume project facts.',
      }),
    );
    expect(fallback.ok).toBe(true);
    await app.close();
    ({ app, page } = await launch(dir));
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await expect(page.getByLabel('资料用途 cv.txt', { exact: true })).toHaveValue('evidence');
    await expect(page.getByRole('checkbox', { name: '发送资料 cv.txt' })).toBeChecked();
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    await page.getByRole('checkbox', { name: '全选待移除资料' }).check();
    await page.getByRole('checkbox', { name: '选择移除 job.txt', exact: true }).uncheck();
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('2 项');
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(1);
    await expect(page.locator('.materials').getByRole('status')).toContainText('已从本页移除 2 项');
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(1);
    for (const path of paths)
      expect(readFileSync(path, 'utf8')).toContain('Fictional local source');
    await app.close();
    ({ app, page } = await launch(dir));
    await expect(page.getByRole('checkbox', { name: '发送资料 job.txt' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

// Stub only the network transport; real URL checks, parsing, IPC, storage and UI remain in use.
async function offlineWeb(app: ElectronApplication) {
  await app.evaluate(() => {
    const dns = process.getBuiltinModule('node:dns/promises') as typeof import('node:dns/promises');
    const https = process.getBuiltinModule('node:https') as typeof import('node:https');
    const { EventEmitter } = process.getBuiltinModule(
      'node:events',
    ) as typeof import('node:events');
    const { Readable } = process.getBuiltinModule('node:stream') as typeof import('node:stream');
    dns.lookup = (async (host: string) => {
      if (host !== 'portfolio.example.com') throw Error('No real DNS in this test');
      return [{ address: '8.8.8.8', family: 4 }];
    }) as unknown as typeof dns.lookup;
    https.request = ((
      options: { servername: string; path: string },
      callback: (res: unknown) => void,
    ) => {
      const req = new EventEmitter() as import('node:events').EventEmitter & { end: () => void };
      req.end = () => {
        if (options.servername !== 'portfolio.example.com') {
          req.emit('error', new Error('No real network'));
          return;
        }
        const response = Readable.from([
          Buffer.from(
            '<title>Fixture ' +
              options.path +
              '</title><p>Fictional project: built accessible interfaces and TypeScript services.</p>',
          ),
        ]);
        Object.assign(response, {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
        callback(response);
      };
      return req;
    }) as typeof https.request;
  });
}
test('O1 mixed webpage purposes, one blocked sibling, project links on three pages and persistence', async () => {
  const dir = dataDir();
  let { app, page } = await launch(dir);
  try {
    await offlineWeb(app);
    for (const [id, label] of [
      ['resume', '设计简历'],
      ['match', '岗位匹配'],
      ['letter', '撰写求职信'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page
        .getByLabel('网页链接草稿', { exact: true })
        .fill(
          'https://portfolio.example.com/cv\nhttps://127.0.0.1/blocked\nhttps://portfolio.example.com/project',
        );
      await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      await page.getByLabel('第1个网页用途', { exact: true }).selectOption('resume');
      await page.getByLabel('第2个网页用途', { exact: true }).selectOption('job');
      await page.getByLabel('第3个网页用途', { exact: true }).selectOption('evidence');
      expect(await page.evaluate((id) => window.career!.materials.list(id), id)).toHaveLength(0);
      await page.getByRole('button', { name: '确认访问并读取', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /^发送资料 / })).toHaveCount(2);
      const status = page.getByRole('region', { name: '本次网页读取状态' });
      await expect(status).toContainText('读取失败');
      const items = await page.evaluate((id) => window.career!.materials.list(id), id);
      expect(items.map((i) => i.purpose)).toEqual(['resume', 'evidence']);
      expect(items.map((i) => i.selected)).toEqual([false, false]);
      expect(items.every((i) => i.workspace === id)).toBe(true);
    }
    expect(await page.evaluate(() => window.career!.materials.list('score'))).toEqual([]);
    await app.close();
    ({ app, page } = await launch(dir));
    for (const id of ['resume', 'match', 'letter'] as const)
      expect(
        (await page.evaluate((id) => window.career!.materials.list(id), id)).map((i) => i.purpose),
      ).toEqual(['resume', 'evidence']);
  } finally {
    await app.close();
  }
});

test('O1 cancelled file queue leaves no material and stale batch confirmation removes nothing', async () => {
  const dir = dataDir();
  const file = join(dir, 'cancel.txt');
  writeFileSync(file, 'Do not import yet.');
  const { app, page } = await launch(dir);
  try {
    await pick(app, [file]);
    await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
    await page.getByRole('button', { name: '取消本次文件导入', exact: true }).click();
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toEqual([]);
    for (const title of ['one', 'two'])
      expect(
        (
          await page.evaluate(
            (title) =>
              window.career!.materials.importText('resume', 'evidence', {
                title,
                text: 'Fictional facts',
              }),
            title,
          )
        ).ok,
      ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    await page.getByRole('checkbox', { name: '全选待移除资料' }).check();
    await page.getByRole('button', { name: '移除所选资料', exact: true }).click();
    await page.evaluate(async () => {
      const [first] = await window.career!.materials.list('resume');
      await window.career!.materials.setPurpose('resume', first.id, first.revision, 'resume');
    });
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(page.locator('.materials').getByRole('alert')).toContainText('本批未移除');
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(2);
    await expect(page.getByLabel('资料用途 本地补充 · one', { exact: true })).toHaveValue('resume');
    expect(readFileSync(file, 'utf8')).toBe('Do not import yet.');
  } finally {
    await app.close();
  }
});

test('O1 changed purpose rejects stale send before network; running AI locks purpose and batch removal', async () => {
  const dir = dataDir();
  const mock = await responsesFixture();
  const { app, page } = await launch(dir);
  try {
    await page.evaluate(async (baseUrl) => {
      const api = window.career!;
      const p = await api.ai.registry.saveProvider({
        name: 'O1 local',
        baseUrl,
        apiKey: 'FAKE-O1',
        protocol: 'chat-completions',
      });
      if (!p.ok) throw Error('provider');
      const m = await api.ai.registry.saveModel({
        providerId: p.catalog.providers[0].id,
        name: 'O1 fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'supported' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw Error('model');
      await api.ai.registry.selectModel(
        'resume',
        m.catalog.models[0].id,
        {},
        m.catalog.pages.resume.revision,
      );
      const imported = await api.materials.importText('resume', 'evidence', {
        title: 'Selected project',
        text: 'Built a fictional TypeScript project.',
      });
      if (!imported.ok) throw Error('material');
      const [item] = imported.items;
      await api.materials.select('resume', item.id, item.revision, true);
    }, mock.baseUrl);
    await page.reload();
    await page.locator('#user-prompt').fill('Draft a resume based only on my selected material.');
    await page.getByRole('button', { name: '生成简历', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认本次发送内容' })).toBeVisible();
    await page.evaluate(async () => {
      const [item] = await window.career!.materials.list('resume');
      await window.career!.materials.setPurpose('resume', item.id, item.revision, 'resume');
    });
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect(
      page.getByText('资料在确认后已变化，请重新核对发送内容。', { exact: true }).first(),
    ).toBeVisible();
    expect(mock.requests).toHaveLength(0);
    await page.reload();
    mock.setMode('slow');
    await page.getByRole('button', { name: '生成简历', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect.poll(() => mock.requests.length).toBe(1);
    await expect(
      page.getByLabel('资料用途 本地补充 · Selected project', { exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: '批量管理', exact: true })).toBeDisabled();
    const replies = await page.evaluate(async () => {
      const api = window.career!.materials;
      const [item] = await api.list('resume');
      return [
        await api.setPurpose('resume', item.id, item.revision, 'evidence'),
        await api.removeMany('resume', [{ id: item.id, revision: item.revision }]),
      ];
    });
    expect(replies.every((r) => !r.ok)).toBe(true);
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(1);
    await page.getByRole('button', { name: '取消生成', exact: true }).click();
    await expect(page.getByRole('button', { name: '批量管理', exact: true })).toBeEnabled();
  } finally {
    await app.close();
    await mock.close();
  }
});
