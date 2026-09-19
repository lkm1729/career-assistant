import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const url =
  'https://cityu.app.kinobi.asia/jobs/1789108699236-6aa3a1db177b02001da5e1b0-careerbridge-ai-agent-builder-trainee-ai-native-development-master-concept-hong-k';
test('opt-in CityU public job live UI import requires consent and never selects or calls AI', async () => {
  test.skip(
    process.env.CAREER_LIVE_JOB_TEST !== '1',
    'Explicit opt-in: visits only the user-provided public job endpoint, no provider or private data.',
  );
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/cityu-live-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
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
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await page.getByLabel('网页链接草稿').fill(url);
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认访问网页', exact: true });
    await expect(dialog).toContainText('https://cityu.server.kinobi.asia/api/job/');
    expect(await page.evaluate(() => window.career!.materials.list('match'))).toHaveLength(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await page.evaluate(() => window.career!.materials.list('match'))).toHaveLength(0);
    await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
    await page.getByRole('button', { name: '确认访问并读取', exact: true }).click();
    await page.waitForFunction(
      () => !!document.querySelector('.material-item, .materials [role="alert"]'),
      undefined,
      { timeout: 30000 },
    );
    await expect(
      page.getByRole('checkbox', { name: '发送资料 网页 · cityu.app.kinobi.asia' }),
    ).toBeVisible();

    const items = await page.evaluate(() => window.career!.materials.list('match'));
    expect(items).toHaveLength(1);
    expect(items[0].selected).toBe(false);
    const text = items[0].pages[0].text;
    expect(text.length).toBeGreaterThan(3000);
    expect(text).toContain('AI Agent Builder Trainee');
    expect(text).toContain('MUST HAVE');
    expect(text).toContain('职责：');
    expect(text).toContain('要求：');
    expect(await page.evaluate(() => window.career!.materials.list('letter'))).toEqual([]);
    expect(await page.evaluate(() => window.career!.match.history())).toEqual([]);
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).providers).toEqual([]);
  } finally {
    await app.close();
  }
});
