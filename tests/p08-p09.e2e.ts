import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pdfFixture, docxFixture, scannedPdfFixture } from './material-fixtures';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
function environment() {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/p08-p09-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  return { dir, env };
}
async function launch(env: Record<string, string>) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
    env,
  });
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
test('P08 offline multi-import PDF DOCX text scan images, explicit truncation, consent, page isolation and reopen', async ({}, info) => {
  test.setTimeout(240000);
  const { dir, env } = environment();
  const pdf = join(dir, 'resume.pdf'),
    docx = join(dir, 'resume.docx'),
    text = join(dir, 'notes.md'),
    many = join(dir, 'nine-pages.pdf'),
    bad = join(dir, 'damaged.pdf'),
    scan = join(dir, 'scan.png'),
    scanned = join(dir, 'scanned.pdf');
  writeFileSync(pdf, pdfFixture());
  writeFileSync(docx, docxFixture());
  writeFileSync(text, 'LOCAL PRIVATE NOTES');
  writeFileSync(many, pdfFixture(9));
  writeFileSync(bad, 'broken pdf');
  let { app, page } = await launch(env);
  try {
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white';
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = 'black';
      x.font = '55px Arial';
      x.fillText('CAREER RESUME SCAN', 60, 160);
      x.fillText('Software engineer projects', 60, 280);
      return {
        png: c.toDataURL('image/png').split(',')[1],
        jpeg: c.toDataURL('image/jpeg', 0.95).split(',')[1],
      };
    });
    writeFileSync(scan, Buffer.from(png.png, 'base64'));
    writeFileSync(scanned, scannedPdfFixture(Buffer.from(png.jpeg, 'base64'), 1200, 900));
    await app.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest((details, cb) =>
        cb({ cancel: /^https?:/.test(details.url) }),
      );
    });
    await pick(app, [pdf, docx, text, many, bad, scan, scanned]);
    await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
    await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
    // Wait for actual import completion, not the absence of a transient status string.
    await expect(page.locator('.material-item')).toHaveCount(7, { timeout: 180000 });
    await expect(
      page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }),
    ).toBeEnabled();
    const items = await page.evaluate(() => window.career!.materials.list('resume'));
    expect(items).toHaveLength(7);
    expect(items.every((i) => !i.selected)).toBe(true);
    const p = items.find((i) => i.name === 'resume.pdf')!;
    expect(p.status, JSON.stringify(p)).toBe('ready');
    expect(p.pages[0].text).toContain('CAREER RESUME');
    expect(p.pages[0].image).toMatch(/^data:image\/jpeg/);
    const d = items.find((i) => i.name === 'resume.docx')!;
    expect(d.status, JSON.stringify(d)).toBe('ready');
    expect(d.pages.map((p) => p.text).join(' ')).toContain('Second page');
    expect(d.pages[0].image).toBeTruthy();
    const large = items.find((i) => i.name === 'nine-pages.pdf')!;
    expect(large.totalPages).toBe(9);
    expect(large.pages).toHaveLength(8);
    expect(large.status).toBe('partial');
    expect(large.warnings.join(' ')).toContain('未评价');
    expect(items.find((i) => i.name === 'damaged.pdf')!.status).toBe('failed');
    const image = items.find((i) => i.name === 'scan.png')!;
    expect(image.pages[0].text).toMatch(/CAREER|RESUME/);
    expect(image.pages[0].ocr).toBeTruthy();
    const scannedItem = items.find((i) => i.name === 'scanned.pdf')!;
    expect(scannedItem.pages[0].ocr).toBeTruthy();
    expect(scannedItem.pages[0].text).toMatch(/CAREER|RESUME/);
    expect(d.pages[0].image).not.toEqual(d.pages[1].image);
    await page.getByRole('checkbox', { name: '发送资料 resume.pdf', exact: true }).check();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 resume.pdf', exact: true }),
    ).toBeChecked();
    await page
      .locator('.material-item')
      .filter({ hasText: 'resume.pdf' })
      .first()
      .locator('summary')
      .first()
      .click();
    await captureWindow(app, info.outputPath('materials-preview.png'));
    // P11 now supports attachments; its manifest must be empty rather than unsupported.
    const letterManifest = await page.evaluate(() =>
      window.career!.materials.manifest('letter', false),
    );
    expect(letterManifest.items).toEqual([]);
    const letterCross = await page.evaluate(
      async ({ id, revision }) => window.career!.materials.select('letter', id, revision, true),
      p,
    );
    expect(letterCross.ok).toBe(false);
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.locator('.material-item')).toHaveCount(0);
    expect(await page.evaluate(() => window.career!.materials.list('score'))).toEqual([]);
    const cross = await page.evaluate(
      async ({ id, revision }) => window.career!.materials.select('score', id, revision, true),
      p,
    );
    expect(cross.ok).toBe(false);
    await app.close();
    ({ app, page } = await launch(env));
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: '发送资料 resume.pdf', exact: true }),
    ).toBeChecked();
  } finally {
    await app.close();
  }
});
test('P08/P09 selected material wire data, visual and text-only scores, independent history, cancellation and stale consent', async ({}, info) => {
  test.setTimeout(240000);
  const { dir, env } = environment();
  const file = join(dir, 'evaluation.pdf');
  writeFileSync(file, pdfFixture());
  let mode = 'ok';
  const requests: Record<string, any>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (mode === 'slow') {
        res.write(': waiting\n\n');
        return;
      }
      const score = body.messages[0].content.includes('coveredPages');
      const content = body.messages[1].content;
      const parts = typeof content === 'string' ? [] : content;
      const materials = parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => {
          try {
            return JSON.parse(p.text);
          } catch {
            return null;
          }
        })
        .filter((x: any) => x?.sourceId);
      const id = materials.find((x: any) => x.purpose === 'resume')?.sourceId ?? 'paste';
      const images = parts.some((p: any) => p.type === 'image_url');
      const output = score
        ? {
            dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
              key,
              score: images || key !== 'visual' ? 80 : null,
              evidence:
                images || key !== 'visual' ? [{ sourceId: id, quote: 'CAREER RESUME' }] : [],
              issues: [],
              suggestions: ['Concrete suggestion'],
            })),
            summary: 'Verified four dimension summary',
            coveredPages: images ? [id] : [],
            unreadablePages: [],
            conflicts: [],
          }
        : {
            document: '# Material generated resume',
            suggestions: 'Advice',
            rationale: 'Evidence based',
          };
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [
              { index: 0, delta: { content: JSON.stringify(output) }, finish_reason: 'stop' },
            ],
          }) +
          '\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as import('node:net').AddressInfo;
  let { app, page } = await launch(env);
  try {
    await page.evaluate(async (baseUrl) => {
      const registry = window.career!.ai.registry;
      const p = await registry.saveProvider({
        name: 'P08 fixture',
        baseUrl,
        apiKey: 'FAKE-P08',
        protocol: 'chat-completions',
      });
      if (!p.ok) throw new Error();
      const m = await registry.saveModel({
        providerId: p.catalog.providers[0].id,
        modelId: 'fixture',
        name: 'P08 Model',
        protocol: 'inherit',
        capabilities: { images: 'supported', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      if (!m.ok) throw new Error();
      for (const target of ['resume', 'score'] as const) {
        const c = await registry.catalog();
        await registry.selectModel(target, m.catalog.models[0].id, {}, c.pages[target].revision);
      }
    }, `http://127.0.0.1:${address.port}/v1`);
    await page.reload();
    await page.locator('#user-prompt').fill('RESUME-PAGE-PRIVATE');
    await pick(app, [file]);
    await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
    await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '发送资料 evaluation.pdf' })).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole('checkbox', { name: '发送资料 evaluation.pdf' }).check();
    await page.getByLabel('本次发送页面图像', { exact: false }).check();
    await page.getByRole('button', { name: '生成简历', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('evaluation.pdf');
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
    expect(JSON.stringify(requests[0])).toContain('image_url');
    expect(JSON.stringify(requests[0])).toContain('CAREER RESUME');
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字').fill('SCORE-PAGE-RESUME');
    await pick(app, [file]);
    await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
    await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '发送资料 evaluation.pdf' })).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole('checkbox', { name: '发送资料 evaluation.pdf' }).check();
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认本次简历评分' })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText('RESUME-PAGE-PRIVATE');
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(page.locator('.evaluation-panel .score-number').first()).toContainText('80');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).not.toContain('RESUME-PAGE-PRIVATE');
    await page.locator('.evaluation-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await captureWindow(app, info.outputPath('score-full.png'));
    await page.getByLabel('本次发送页面图像', { exact: false }).uncheck();
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(page.locator('.evaluation-panel .score-number').first()).toContainText('—');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(2);
    expect(JSON.stringify(requests[2])).not.toContain('image_url');
    await page.locator('.evaluation-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await captureWindow(app, info.outputPath('score-partial.png'));
    mode = 'slow';
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消评分', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消评分', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消评分', exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(2);
    mode = 'ok';
    const stale = await page.evaluate(async () => {
      const c = await window.career!.score.prepare(false);
      if (!c.ok) throw new Error();
      const snapshot = await window.career!.load();
      await window.career!.saveWorkspace('score', {
        ...snapshot.workspaces.score,
        prompt: 'Changed target',
      });
      return window.career!.score.run(c.value);
    });
    expect(stale.ok).toBe(false);
    expect(requests).toHaveLength(4);
    await app.close();
    ({ app, page } = await launch(env));
    await expect(page.locator('.evaluation-panel .score-number').first()).toContainText('—');
    expect(await page.evaluate(() => window.career!.score.history())).toHaveLength(2);
    expect(await page.evaluate(() => window.career!.ai.listResumeVersions())).toHaveLength(1);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
