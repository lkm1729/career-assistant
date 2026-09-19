import { test, expect } from '@playwright/test';
import { launch, dataDir } from './o7-web-fixture';
import { captureWindow } from './capture-window';

for (const [id, name] of [
  ['resume', '设计简历'],
  ['score', '简历评分'],
  ['match', '岗位匹配'],
  ['letter', '撰写求职信'],
] as const) {
  test(`O12 web header ${id}: bold left title, contained subtitle, matching padding and keyboard toggle`, async ({}, info) => {
    const { app, page } = await launch(dataDir());
    try {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const card = page.locator('.material-entry-web');
      const summary = card.locator(':scope > summary');
      const input = page.getByRole('textbox', { name: '网页链接草稿', exact: true });
      await input.fill('https://portfolio.example.com/only-a-draft');
      for (const [width, theme] of [
        [1280, '浅色'],
        [800, '深色'],
      ] as const) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0];
          w.setMinimumSize(760, 600);
          w.setSize(width, 1050);
        }, width);
        await page.getByRole('button', { name: theme, exact: true }).click();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await card.scrollIntoViewIfNeeded();
        const metrics = await card.evaluate((el) => {
          const summary = el.querySelector(':scope > summary')!;
          const title = summary.querySelector('strong') ?? summary.querySelector('span')!;
          const subtitle = summary.querySelector('small')!;
          const icon = summary.querySelector('svg')!;
          const reference = document.querySelector('.material-entry-files')!;
          const rect = (node: Element) => {
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
          };
          return {
            card: rect(el),
            title: rect(title),
            icon: rect(icon),
            subtitle: rect(subtitle),
            titleSize: parseFloat(getComputedStyle(title).fontSize),
            titleWeight: Number(getComputedStyle(title).fontWeight),
            padding: getComputedStyle(el).paddingLeft,
            accentWidth: getComputedStyle(el).borderLeftWidth,
            fileAccentWidth: getComputedStyle(reference).borderLeftWidth,
            referencePadding: getComputedStyle(reference).paddingLeft,
            overflow: el.scrollWidth > el.clientWidth,
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        await card.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        // Wake the hidden compositor after scrolling; otherwise a native capture can be a stale frame.
        await app.evaluate(async ({ BrowserWindow }) => {
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          });
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await captureWindow(app, info.outputPath(`${id}-${width}-${theme}.png`));
        expect(
          metrics.titleSize,
          'title must not inherit the legacy 9px annotation rule',
        ).toBeGreaterThanOrEqual(18);
        expect(metrics.titleWeight).toBeGreaterThanOrEqual(700);
        expect(metrics.accentWidth).toBe('4px');
        expect(metrics.fileAccentWidth).toBe('4px');
        expect(
          metrics.title.x - metrics.icon.right,
          'title stays beside icon rather than pushed to far right',
        ).toBeLessThanOrEqual(16);
        expect(metrics.padding, 'same card inset as file import').toBe(metrics.referencePadding);
        expect(metrics.subtitle.x).toBeGreaterThanOrEqual(
          metrics.card.x + parseFloat(metrics.padding),
        );
        expect(metrics.subtitle.right).toBeLessThanOrEqual(
          metrics.card.right - parseFloat(metrics.padding),
        );
        expect(metrics.subtitle.y).toBeGreaterThanOrEqual(metrics.title.bottom);
        expect(metrics.overflow).toBe(false);
        expect(metrics.pageOverflow).toBe(false);
        await summary.focus();
        await summary.press('Enter');
        await expect(input).not.toBeVisible();
        await summary.press('Space');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('https://portfolio.example.com/only-a-draft');
        expect(await page.evaluate((p) => window.career!.materials.list(p), id)).toHaveLength(0);
      }
    } finally {
      await app.close();
    }
  });
}
