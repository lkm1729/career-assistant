import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);

test('settings reveal key, preserve it on URL edit, and use provider-only protocols in both themes', async () => {
  mkdirSync('.test-data', { recursive: true });
  const directory = mkdtempSync(resolve('.test-data/settings-verification-'));
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
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '浅色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      )
      .toBe('#2878d4');
    await page.getByRole('button', { name: '添加供应商', exact: true }).click();
    await expect(page.getByRole('button', { name: '显示 API Key', exact: true })).toBeVisible({
      timeout: 2000,
    });
    const key = page.getByLabel('API Key', { exact: true });
    await key.fill('FAKE-UI-KEY');
    await expect(key).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
    await expect(key).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: '隐藏 API Key', exact: true })).toHaveCSS(
      'color',
      'rgb(40, 120, 212)',
    );
    await dialog.getByRole('button', { name: '深色', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      )
      .toBe('#ffd43b');
    await expect(page.getByRole('button', { name: '隐藏 API Key', exact: true })).toHaveCSS(
      'color',
      'rgb(40, 120, 212)',
    );
    await page.getByRole('button', { name: '隐藏 API Key', exact: true }).click();
    await expect(key).toHaveAttribute('type', 'password');
    await page.getByLabel('供应商名称', { exact: true }).fill('Verification Provider');
    await page.getByLabel('默认接口协议', { exact: true }).selectOption('anthropic');
    await page.getByLabel('Base URL', { exact: true }).fill('https://old.invalid/v1');
    await page.getByRole('button', { name: '保存供应商', exact: true }).click();
    await expect(dialog).toContainText('供应商已保存');
    await page
      .getByRole('button', { name: '编辑供应商 Verification Provider', exact: true })
      .click();
    await expect(key).toHaveValue('');
    await page.getByLabel('Base URL', { exact: true }).fill('https://new.invalid/proxy/v1');
    await page.getByRole('button', { name: '保存供应商', exact: true }).click();
    await expect(dialog).toContainText('供应商已保存');
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await expect(page.getByLabel('模型协议', { exact: true })).toHaveCount(0);
    await page.getByLabel('模型 ID', { exact: true }).fill('fixture-model');
    await page.getByLabel('模型显示名称', { exact: true }).fill('Verification Model');
    await expect(page.locator('.endpoint-preview')).toContainText(
      'https://new.invalid/proxy/v1/messages',
    );
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await expect(dialog).toContainText('模型已保存');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await captureWindow(app, resolve(directory, 'dark.png'));
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.locator('.nav-item.active')).toHaveCSS(
      'background-color',
      'rgb(232, 242, 255)',
    );
    await expect(page.locator('.nav-item.active')).toHaveCSS('color', 'rgb(40, 120, 212)');
    await expect(page.getByRole('button', { name: '浅色', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await captureWindow(app, resolve(directory, 'light.png'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const animation = await page.evaluate(() => {
      const h = document.createElement('h3');
      h.className = 'ai-thinking';
      h.textContent = '正在起草';
      document.body.append(h);
      const name = getComputedStyle(h).animationName;
      h.remove();
      return name;
    });
    expect(animation).toBe('none');
  } finally {
    await app.close();
  }
});
