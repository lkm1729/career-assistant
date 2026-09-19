import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
async function fixture() {
  let status = 200,
    hold = true;
  let answer = JSON.stringify({
    document: '# Fictional letter',
    suggestions: 'Only supplied facts.',
    rationale: 'Fixture.',
  });
  const requests: { method: string; body: string }[] = [];
  const pending = new Set<() => void>();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', body });
      const finish = () => {
        pending.delete(finish);
        if (res.destroyed) return;
        if (status !== 200) {
          res.writeHead(status);
          res.end('PRIVATE-ERROR-BODY');
          return;
        }
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"data":[]}');
          return;
        }
        const value = body.includes('Reply with only OK.') ? 'OK' : answer;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(
          'data: ' +
            JSON.stringify({
              choices: [{ index: 0, delta: { content: value }, finish_reason: 'stop' }],
            }) +
            '\n\ndata: [DONE]\n\n',
        );
      };
      res.on('close', () => pending.delete(finish));
      if (hold) pending.add(finish);
      else finish();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o2-ui-'));
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
  await page.evaluate(
    async (baseUrl) => {
      const api = window.career!;
      const saved = await api.ai.registry.saveProvider({
        name: 'O2 fixture',
        baseUrl,
        apiKey: 'FAKE-O2',
        protocol: 'chat-completions',
      });
      if (!saved.ok) throw Error('provider');
      let first = '';
      for (let i = 0; i < 9; i++) {
        const m = await api.ai.registry.saveModel({
          providerId: saved.catalog.providers[0].id,
          name: 'Fixture ' + i,
          modelId: 'fixture-' + i,
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
        if (!i) first = m.catalog.models[0].id;
      }
      for (const id of ['resume', 'letter', 'match', 'score'] as const) {
        const c = await api.ai.registry.catalog();
        await api.ai.registry.selectModel(id, first, {}, c.pages[id].revision);
      }
    },
    'http://127.0.0.1:' + address.port + '/v1',
  );
  await page.reload();
  return {
    app,
    page,
    requests,
    release: () => {
      for (const done of [...pending]) done();
    },
    setStatus: (n: number) => (status = n),
    setHold: (v: boolean) => (hold = v),
    setAnswer: (text: string) => (answer = text),
    close: async () => {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
async function settled(page: Page, label: string) {
  await expect(page.getByRole('region', { name: label, exact: true })).toHaveAttribute(
    'data-pending',
    'false',
  );
  await expect(
    page.getByRole('region', { name: label, exact: true }).locator('.spin,.ai-thinking'),
  ).toHaveCount(0);
}

test('O2 long workbench shows local match/letter activity, guards repeat clicks and settles success/error/cancel', async ({}, info) => {
  const f = await fixture();
  const { page, app } = f;
  try {
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await page.locator('#user-prompt').fill('Python required');
    await page.getByLabel('匹配使用的简历正文').fill('Python engineering');
    f.setAnswer(
      JSON.stringify({
        requirements: [
          {
            id: 'r1',
            requirement: 'Python',
            hard: false,
            status: 'met',
            jobEvidence: [{ sourceId: 'job', quote: 'Python required' }],
            evidence: [{ sourceId: 'resume', quote: 'Python engineering' }],
            note: 'Verified fictional evidence',
          },
        ],
        summary: 'Fixture match',
        recommendation: 'apply',
        reasons: ['Python experience'],
        warnings: [],
      }),
    );
    await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
    await page
      .getByRole('button', { name: '确认发送并匹配', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    const status = page.getByRole('region', { name: '岗位匹配操作反馈', exact: true });
    await expect(status).toHaveAttribute('data-pending', 'true');
    await expect(status.locator('.spin')).toHaveCount(1);
    await expect(status.locator('.ai-thinking')).toHaveCount(1);
    await expect.poll(() => f.requests.length).toBe(1);
    await expect(page.getByRole('button', { name: '评估匹配度', exact: true })).toBeDisabled();
    await expect(status).toBeInViewport();
    await expect(status.getByRole('button', { name: '停止本次匹配' })).toBeEnabled();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(app, info.outputPath('o2-match-pending.png'));
    f.release();
    await settled(page, '岗位匹配操作反馈');
    await expect(status).toContainText('匹配结果已保存');
    await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
    await page.locator('#user-prompt').fill('Python required');
    await page.getByLabel('求职信使用的简历正文').fill('Python engineering');
    f.setAnswer(
      JSON.stringify({
        document: '# Fictional letter',
        suggestions: 'Only supplied facts.',
        rationale: 'Fixture.',
      }),
    );
    await page.getByRole('button', { name: '生成求职信', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    const letter = page.getByRole('region', { name: '求职信操作反馈', exact: true });
    await expect(letter).toHaveAttribute('data-pending', 'true');
    await expect(letter).toBeInViewport();
    await expect(letter.getByRole('button', { name: '停止本次生成' })).toBeEnabled();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(letter.locator('.spin')).toHaveCSS('animation-name', 'none');
    await expect(letter.locator('.ai-thinking')).toHaveCSS('animation-name', 'none');
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await letter.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(app, info.outputPath('o2-letter-reduced-dark.png'));
    await letter.getByRole('button', { name: '停止本次生成' }).click();
    await settled(page, '求职信操作反馈');
    await expect(letter).toContainText('取消');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    f.setStatus(429);
    await page.getByRole('button', { name: '生成求职信', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect.poll(() => f.requests.length).toBe(3);
    f.release();
    await settled(page, '求职信操作反馈');
    await expect(letter).toContainText('429');
    expect(await page.evaluate(() => window.career!.ai.getHistory('letter'))).toMatchObject({
      versions: [],
    });
    await expect(page.locator('body')).not.toContainText('PRIVATE-ERROR-BODY');
    f.setStatus(200);
    await page.getByRole('button', { name: '生成求职信', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
    await expect.poll(() => f.requests.length).toBe(4);
    f.release();
    await settled(page, '求职信操作反馈');
    await expect(letter).toContainText('已保存正式版本 V1');
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.getByLabel('评分简历文字').fill('Python engineering');
    await page.getByRole('button', { name: '开始评分', exact: true }).click();
    await page.getByRole('button', { name: '确认发送并评分', exact: true }).click();
    const score = page.getByRole('region', { name: '简历评分操作反馈', exact: true });
    await expect(score).toHaveAttribute('data-pending', 'true');
    await score.getByRole('button', { name: '停止本次评分' }).click();
    await settled(page, '简历评分操作反馈');
  } finally {
    await f.close();
  }
});

test('O2 model confirmation and test feedback remain inside selected card; provider cancel stays beside probe', async ({}, info) => {
  const f = await fixture();
  const { page, app } = f;
  try {
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    const card = page.locator('.model-card').filter({
      has: page.getByRole('button', { name: '测试模型连通性 · Fixture 0', exact: true }),
    });
    await card.getByRole('button', { name: '测试模型连通性 · Fixture 0', exact: true }).click();
    const confirmation = card.getByRole('region', { name: '测试发送确认', exact: true });
    await expect(confirmation).toBeVisible();
    expect(f.requests).toHaveLength(0);
    await confirmation
      .getByRole('button', { name: '确认发送测试' })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    const feedback = card.getByRole('region', { name: '模型测试反馈 Fixture 0', exact: true });
    await expect(feedback).toHaveAttribute('data-pending', 'true');
    await expect.poll(() => f.requests.length).toBe(1);
    await expect(feedback.getByRole('button', { name: '取消测试', exact: true })).toBeEnabled();
    await expect(
      card.getByRole('button', { name: '测试模型连通性 · Fixture 0', exact: true }),
    ).toBeDisabled();
    await feedback.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(app, info.outputPath('o2-model-local.png'));
    f.release();
    await settled(page, '模型测试反馈 Fixture 0');
    await expect(feedback).toContainText('通过');
    f.setStatus(503);
    await card.getByRole('button', { name: '测试模型连通性 · Fixture 0', exact: true }).click();
    await card.getByRole('button', { name: '确认发送测试' }).click();
    await expect.poll(() => f.requests.length).toBe(2);
    f.release();
    await expect(card.getByRole('alert').first()).toContainText('503');
    await expect(card.locator('.spin')).toHaveCount(0);
    f.setStatus(200);
    const provider = page.getByRole('region', { name: '供应商连通性', exact: true });
    await provider
      .getByRole('button', { name: '测试供应商连通性 · O2 fixture', exact: true })
      .click();
    await provider.getByRole('button', { name: '确认测试供应商' }).click();
    await expect(provider.getByRole('region', { name: '供应商测试反馈' })).toHaveAttribute(
      'data-pending',
      'true',
    );
    await provider.getByRole('button', { name: '取消测试', exact: true }).click();
    await expect(provider.locator('.spin')).toHaveCount(0);
    await expect(provider.getByRole('alert').first()).toContainText('取消');
    expect(f.requests.filter((r) => r.method === 'GET').every((r) => r.body === '')).toBe(true);
  } finally {
    await f.close();
  }
});

test('O2 single material removal confirms at its row, retains a local result and stale errors stay local', async ({}, info) => {
  const f = await fixture();
  const { page, app } = f;
  try {
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++)
        await window.career!.materials.importText('resume', 'evidence', {
          title: 'Project ' + i,
          text: 'Fictional source ' + i,
        });
    });
    await page.reload();
    const row = page
      .locator('.material-item')
      .filter({ has: page.getByLabel('资料用途 本地补充 · Project 5', { exact: true }) });
    await row.getByRole('button', { name: '移除', exact: true }).click();
    await expect(row.getByRole('alertdialog', { name: '确认移除资料' })).toBeVisible();
    await row.getByRole('button', { name: '取消', exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '移除', exact: true }).click();
    await page.evaluate(async () => {
      const item = (await window.career!.materials.list('resume')).find((i) =>
        i.name.endsWith('Project 5'),
      )!;
      await window.career!.materials.setPurpose('resume', item.id, item.revision, 'resume');
    });
    await row.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('本批未移除');
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(8);
    await row.getByRole('button', { name: '移除', exact: true }).click();
    await row.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(row).toHaveCount(0);
    const result = page.getByRole('article', { name: '资料移除结果 本地补充 · Project 5' });
    await expect(result).toContainText('已从本页移除 1 项');
    await expect(result.locator('.spin')).toHaveCount(0);
    await result.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await captureWindow(app, info.outputPath('o2-remove-local.png'));
    expect(await page.evaluate(() => window.career!.materials.list('resume'))).toHaveLength(7);
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await expect(page.getByRole('region', { name: '资料操作反馈' })).toHaveCount(0);
    expect(f.requests).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('O2 configuration deletion confirms beside selected row and preserves a nearby completion result', async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    const card = page
      .locator('.model-card')
      .filter({ has: page.getByRole('button', { name: '删除模型 Fixture 6', exact: true }) });
    await card.getByRole('button', { name: '删除模型 Fixture 6', exact: true }).click();
    await expect(card.getByRole('region', { name: '删除影响确认' })).toBeVisible();
    await card.getByRole('button', { name: '取消', exact: true }).click();
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).models).toHaveLength(
      9,
    );
    await card.getByRole('button', { name: '删除模型 Fixture 6', exact: true }).click();
    await card.getByRole('button', { name: '确认删除所选配置', exact: true }).click();
    const result = page.getByRole('article', { name: '配置删除结果 Fixture 6' });
    await expect(result).toContainText('草稿和历史版本保持不变');
    await expect(result.locator('.spin')).toHaveCount(0);
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).models).toHaveLength(
      8,
    );
    const provider = page
      .locator('.provider-row')
      .filter({ has: page.getByRole('button', { name: '删除供应商 O2 fixture', exact: true }) });
    await provider.getByRole('button', { name: '删除供应商 O2 fixture', exact: true }).click();
    await expect(provider.getByRole('region', { name: '删除影响确认' })).toBeVisible();
    await provider.getByRole('button', { name: '确认删除所选配置', exact: true }).click();
    await expect(page.getByRole('region', { name: '配置删除结果 O2 fixture' })).toContainText(
      '已删除所选配置',
    );
    expect(
      (await page.evaluate(() => window.career!.ai.registry.catalog())).providers,
    ).toHaveLength(0);
    expect(f.requests).toHaveLength(0);
  } finally {
    await f.close();
  }
});
