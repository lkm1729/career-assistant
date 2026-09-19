import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
const require = createRequire(import.meta.url);
const url =
  'https://cityu.app.kinobi.asia/jobs/1789108696696-6aa3a1d8177b02001da5dff6-careerbridge-graduate-trainee-automated-system-h-k-limited-hk';
async function launch() {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/web-dns-ui-'));
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
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return { app, page };
}
test('both webpage dialogs disclose public DNS and reset opt-in after cancel and tab switch, without network', async () => {
  const { app, page } = await launch();
  try {
    for (const label of ['岗位匹配', '撰写求职信']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByLabel('网页链接草稿', { exact: true }).fill(url);
      await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '确认访问网页' });
      const consent = dialog.getByRole('checkbox', { name: '允许公共 DNS 兼容解析（仅本次）' });
      await expect(consent).not.toBeChecked();
      await expect(dialog).toContainText('cloudflare-dns.com / 1.1.1.1');
      await expect(dialog).toContainText('不接收链接路径');
      await consent.check();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      await expect(consent).not.toBeChecked();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    expect(await page.evaluate(() => window.career!.materials.list('match'))).toEqual([]);
    expect(await page.evaluate(() => window.career!.materials.list('letter'))).toEqual([]);
    const invalid = await page.evaluate(
      (url) => window.career!.materials.importUrl('match', 'job', url, 'true' as never),
      url,
    );
    expect(invalid.ok).toBe(false);
  } finally {
    await app.close();
  }
});
test('opt-in real user CityU URL imports in match and letter with safe public DNS and no AI', async () => {
  test.skip(
    process.env.CAREER_LIVE_JOB_TEST !== '1',
    'Explicit opt-in: user public job and Cloudflare DNS, no credentials or AI.',
  );
  const synthetic = (await lookup('cityu.server.kinobi.asia', { family: 4, all: true })).every(
    (a) => /^198\.(18|19)\./.test(a.address),
  );
  const { app, page } = await launch();
  try {
    for (const [id, label] of [
      ['match', '岗位匹配'],
      ['letter', '撰写求职信'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByLabel('网页链接草稿', { exact: true }).fill(url);
      await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '确认访问网页' });
      if (synthetic) {
        await dialog.getByRole('button', { name: '确认访问并读取', exact: true }).click();
        await expect(page.getByRole('region', { name: '本次网页读取状态' })).toContainText(
          'WEB_DNS_SYNTHETIC',
        );
        expect(await page.evaluate((id) => window.career!.materials.list(id), id)).toEqual([]);
        await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      }
      await dialog.getByRole('checkbox', { name: '允许公共 DNS 兼容解析（仅本次）' }).check();
      await dialog.getByRole('button', { name: '确认访问并读取', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /发送资料 网页/ })).toHaveCount(1, {
        timeout: 25000,
      });
      const items = await page.evaluate((id) => window.career!.materials.list(id), id);
      expect(items).toHaveLength(1);
      expect(items[0].selected).toBe(false);
      expect(items[0].sourceUrl).toBe(url);
      expect(items[0].pages[0].text).toContain('Graduate Trainee');
      expect(items[0].pages[0].text).toContain('职责：');
      expect(items[0].pages[0].text).toContain('要求：');
      expect(items[0].pages[0].text.length).toBeGreaterThan(1000);
      await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
      await expect(dialog.getByRole('checkbox')).not.toBeChecked();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    expect((await page.evaluate(() => window.career!.ai.registry.catalog())).providers).toEqual([]);
    expect(await page.evaluate(() => window.career!.match.history())).toEqual([]);
  } finally {
    await app.close();
  }
});
