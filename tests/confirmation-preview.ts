import { expect, type Page } from '@playwright/test';
/** Existing full-preview regressions explicitly opt into O11's collapsed details. */
export async function revealConfirmation(page: Page) {
  const dialog = page.getByRole('dialog');
  for (const title of ['查看本次发送内容', '连接、参数与处理说明']) {
    const summary = dialog.getByText(title, { exact: true });
    await expect(summary).toBeVisible();
    const details = summary.locator('..');
    if (!(await details.evaluate((d) => d.hasAttribute('open')))) await summary.click();
    await expect(details.locator('.confirmation-details-body')).toBeVisible();
  }
}
