import { captureWindow } from './capture-window';
import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const dataRoot = resolve('.test-data');
mkdirSync(dataRoot, { recursive: true });
function newDirectory() {
  return mkdtempSync(join(dataRoot, 'p01-'));
}
async function launch(data: string) {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: ['.'],
    env,
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return { app, page };
}

test('four independent drafts and selected tab survive immediate close and reopen', async () => {
  const directory = newDirectory();
  let { app, page } = await launch(directory);
  try {
    for (const [name, value] of [
      ['设计简历', '简历经历 A'],
      ['简历评分', '评分目标 B'],
      ['岗位匹配', '目标岗位 C'],
      ['撰写求职信', '求职信要求 D'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('#user-prompt')).toHaveValue('');
      await page.locator('#user-prompt').fill(value);
    }
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await page
      .getByRole('textbox', { name: '正文草稿' })
      .fill('# Dear team\n\nMy **real** experience.');
    await page.getByRole('textbox', { name: '修改要求' }).fill('请用自然语气');
    await app.close();
    ({ app, page } = await launch(directory));
    await expect(page.getByRole('button', { name: '撰写求职信', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('#user-prompt')).toHaveValue('求职信要求 D');
    await expect(page.getByRole('textbox', { name: '修改要求' })).toHaveValue('请用自然语气');
    await page.getByRole('button', { name: 'Raw Text', exact: true }).click();
    await expect(page.locator('.raw-document')).toContainText('My real experience.');
    await expect(page.locator('.raw-document')).not.toContainText('**');
    for (const [name, value] of [
      ['设计简历', '简历经历 A'],
      ['简历评分', '评分目标 B'],
      ['岗位匹配', '目标岗位 C'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('#user-prompt')).toHaveValue(value);
    }
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await expect(page.getByText('好的表达，从真实经历开始', { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('theme persists and a narrow window keeps evaluation cards usable', async ({}, testInfo) => {
  const directory = newDirectory();
  let { app, page } = await launch(directory);
  try {
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await expect(page.getByRole('group', { name: '评分维度' }).getByRole('button')).toHaveCount(4);
    await page.getByRole('button', { name: /结构、视觉排版与可读性/ }).click();
    await expect(page.locator('.dimension-description')).toContainText('需要实际页面图像');
    await expect(page.locator('.score-number')).toHaveText('—/100');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 1000));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await captureWindow(app, testInfo.outputPath('score-dark-narrow.png'));
    await app.close();
    ({ app, page } = await launch(directory));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '跟随系统', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await app.close();
  }
});

test('system prompt edits stay isolated; resetting requires confirmation', async () => {
  const { app, page } = await launch(newDirectory());
  try {
    await page.locator('.system-prompt summary').click();
    await page.getByRole('textbox', { name: '系统提示词正文' }).fill('我的自定义简历顾问');
    await page.getByRole('button', { name: '恢复默认提示词', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '系统提示词正文' })).toHaveValue(
      '我的自定义简历顾问',
    );
    await page.getByRole('button', { name: '简历评分', exact: true }).click();
    await page.locator('.system-prompt summary').click();
    await expect(page.getByRole('textbox', { name: '系统提示词正文' })).not.toHaveValue(
      '我的自定义简历顾问',
    );
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await page.locator('.system-prompt summary').click();
    await page.getByRole('button', { name: '恢复默认提示词', exact: true }).click();
    await page.getByRole('button', { name: '确认恢复默认', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '系统提示词正文' })).toHaveValue(
      /Career Advisor/,
    );
  } finally {
    await app.close();
  }
});

test('Markdown is inert, APIs are unavailable, and settings never request a key', async ({}, testInfo) => {
  const { app, page } = await launch(newDirectory());
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  try {
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成简历', exact: true })).toBeDisabled();
    await captureWindow(app, testInfo.outputPath('resume-light.png'));
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await page
      .getByRole('textbox', { name: '正文草稿' })
      .fill(
        '# 安全草稿\n\n<script>window.__unsafe = true</script>\n\n![image](https://example.com/track.png)\n\n[link](javascript:alert(1))',
      );
    await page.getByRole('button', { name: '阅读预览', exact: true }).click();
    await expect(page.locator('.markdown-body')).toContainText('安全草稿');
    await expect(page.locator('.markdown-body img')).toHaveCount(0);
    await expect(page.locator('.markdown-body a')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__unsafe),
    ).toBeUndefined();
    expect(
      await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).require),
    ).toBe('undefined');
    expect(remoteRequests).toEqual([]);
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('统一管理连接，各标签页独立选择模型');
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('keyboard skip-to-workspace does not break draft saving or close acknowledgment', async () => {
  const directory = newDirectory();
  let { app, page } = await launch(directory);
  try {
    await page.getByRole('link', { name: '跳转到工作区' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    await page.locator('#user-prompt').fill('跳转之后仍需保存的经历');
    await expect(page.getByRole('status')).toContainText('草稿已同步到本机');
    await app.close();
    ({ app, page } = await launch(directory));
    await expect(page.locator('#user-prompt')).toHaveValue('跳转之后仍需保存的经历');
  } finally {
    await app.close();
  }
});

test('a failed disk write stays visible and can be retried without losing the edited draft', async () => {
  const directory = newDirectory();
  const { app, page } = await launch(directory);
  const { DatabaseSync } = await import('node:sqlite');
  const lock = new DatabaseSync(join(directory, 'workspace.sqlite'));
  let locked = false;
  try {
    await page.locator('#user-prompt').fill('原有已保存经历');
    await expect(page.getByRole('status')).toContainText('草稿已同步到本机');
    lock.exec('BEGIN IMMEDIATE');
    locked = true;
    await page.locator('#user-prompt').fill('磁盘忙碌时的新修改');
    await expect(page.getByRole('alert')).toContainText('尚未保存到磁盘');
    await expect(page.locator('#user-prompt')).toHaveValue('磁盘忙碌时的新修改');
    lock.exec('ROLLBACK');
    locked = false;
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('草稿已同步到本机');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
    await page.getByRole('button', { name: '设计简历', exact: true }).click();
    await expect(page.locator('#user-prompt')).toHaveValue('磁盘忙碌时的新修改');
  } finally {
    if (locked) lock.exec('ROLLBACK');
    lock.close();
    await page
      .getByRole('button', { name: '重试保存', exact: true })
      .click({ timeout: 1000 })
      .catch(() => {});
    await app.close();
  }
});
