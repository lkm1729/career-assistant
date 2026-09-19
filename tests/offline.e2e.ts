import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('offline editing, inert external Markdown, privacy notice and reopen need no AI request', async () => {
  mkdirSync(resolve('.test-data'), { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/offline-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const document =
    '# Offline resume\n\n![private](https://example.invalid/track.png)\n\n[link](https://example.invalid)\n\n<script>window.untrustedRan = true</script>';
  for (let run = 0; run < 2; run++) {
    const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
      await page.context().setOffline(true);
      await app.evaluate(() => {
        Object.assign(globalThis, { offlineTestRequests: 0 });
        globalThis.fetch = async () => {
          const state = globalThis as unknown as { offlineTestRequests: number };
          state.offlineTestRequests++;
          throw new Error('Offline test forbids API requests');
        };
      });
      if (run === 0) {
        await page.locator('#user-prompt').fill('离线经历：只保存本机');
        await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
        await page.getByRole('textbox', { name: '正文草稿' }).fill(document);
        await page.getByRole('button', { name: '阅读预览', exact: true }).click();
      } else {
        await expect(page.locator('#user-prompt')).toHaveValue('离线经历：只保存本机');
      }
      await expect(page.locator('.markdown-body')).toContainText('Offline resume');
      await expect(
        page.locator('.markdown-body img, .markdown-body a, .markdown-body script'),
      ).toHaveCount(0);
      expect(await page.evaluate(() => 'untrustedRan' in window)).toBe(false);
      await page.getByRole('button', { name: '应用设置', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('无应用自建云同步、遥测或自动上传');
      await expect(page.getByRole('dialog')).toContainText('供应商可能保留请求日志');
      await page.getByRole('button', { name: '完成', exact: true }).click();
      expect(
        await app.evaluate(
          () => (globalThis as unknown as { offlineTestRequests: number }).offlineTestRequests,
        ),
      ).toBe(0);
      expect((await page.evaluate(() => window.career!.load())).workspaces.resume.document).toBe(
        document,
      );
    } finally {
      await app.close();
    }
  }
});
