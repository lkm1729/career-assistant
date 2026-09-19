import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture as streamFixture, activate } from './o6-performance-fixture';
import { test, expect } from '@playwright/test';
import { launch } from './o7-web-fixture';
import { seedO9, sourceId, sourceName } from './o9-fixture';
import { pages } from '../src/content';
import { captureWindow } from './capture-window';

test('O9 four result regions, manual focus, themes, narrow layout and reduced motion', async ({}, info) => {
  const { app, page } = await launch(seedO9());
  const remote: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) remote.push(r.url());
  });
  try {
    for (const id of ['resume', 'score', 'match', 'letter'] as const) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(pages[id].name) })
        .click();
      await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
      await expect(page.locator(`#ai-result-${id}`)).toBeFocused();
      const result = page.locator('.ai-result-panel');
      await expect(result.locator('.result-eyebrow')).toHaveText('AI 回答区');
      await expect(result).toHaveCSS('border-top-width', '3px');
      await expect(result.locator('.result-state')).not.toContainText('正在');
      expect(await result.innerText()).not.toContain(sourceId);
      expect(await result.innerText()).not.toContain('PRIVATE-UNSELECTED');
      for (const theme of ['light', 'dark']) {
        await page
          .getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true })
          .click();
        await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
        await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        await captureWindow(app, info.outputPath(`${id}-${theme}.png`));
      }
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setMinimumSize(760, 600);
        w.setSize(800, 900);
      });
      await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      await captureWindow(app, info.outputPath(`${id}-narrow-dark.png`));
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1448, 1008),
      );
    }
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setMinimumSize(760, 600);
      w.setSize(800, 900);
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await captureWindow(app, info.outputPath('letter-narrow-dark.png'));
    expect(remote).toEqual([]);
  } finally {
    await app.close();
  }
});

test('O9 historic citations, literal evidence, raw editor and restart persistence', async ({}, info) => {
  const dir = seedO9();
  let { app, page } = await launch(dir);
  try {
    await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
    await expect(page.locator('.markdown-body').first()).toContainText(sourceName);
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '正文草稿', exact: true });
    expect(await editor.inputValue()).toContain(sourceId);
    await editor.fill((await editor.inputValue()) + '\n\n手动修改');
    await expect(page.locator('.result-state')).toContainText('手动编辑稿');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /简历评分/ })
      .click();
    await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
    const quote = page.locator('.evidence-quote').first();
    await expect(quote.locator('.evidence-caption')).toContainText(sourceName + ' · 第 1 页');
    await expect(quote.locator('code')).not.toBeVisible();
    await quote.getByText('引用技术详情', { exact: true }).click();
    await expect(quote.locator('code')).toHaveText(sourceId);
    await quote.getByText('引用技术详情', { exact: true }).click();
    await page.getByText('独立评估历史 · 3 条', { exact: true }).click();
    await page.locator('.score-history > article > button').nth(1).click();
    await expect(page.locator('.result-state')).toContainText('历史评估');
    await expect(page.locator('.evidence-caption').first()).toHaveText('参考资料 · 第 3 页');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /岗位匹配/ })
      .click();
    await page.getByText('逐项岗位要求与来源证据', { exact: true }).click();
    await expect(page.locator('.evidence-caption').nth(1)).toContainText(sourceName);
    await page.getByRole('button', { name: '查看 AI 结果', exact: true }).click();
    await captureWindow(app, info.outputPath('match-citations.png'));
    await app.close();
    ({ app, page } = await launch(dir));
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /设计简历/ })
      .click();
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '正文草稿', exact: true })).toHaveValue(
      /手动修改/,
    );
    expect(
      await page.getByRole('textbox', { name: '正文草稿', exact: true }).inputValue(),
    ).toContain(sourceId);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /简历评分/ })
      .click();
    await expect(page.locator('.evidence-caption').first()).toHaveText('参考资料 · 第 3 页');
  } finally {
    await app.close();
  }
});

test('O9 readable copy/export preserve the raw saved source', async () => {
  const dir = seedO9();
  const { app, page } = await launch(dir);
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            Object.assign(window, { o9Copied: text });
          },
        },
      });
    });
    const copied = () => page.evaluate(() => (window as unknown as { o9Copied: string }).o9Copied);
    const exportPath = join(dir, 'o9-export.md');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    await page.getByRole('button', { name: '复制正文', exact: true }).click();
    expect(await copied()).toContain('当时使用的项目简历与完整经历');
    expect(await copied()).not.toContain(sourceId);
    await page.getByRole('button', { name: '导出草稿', exact: true }).click();
    await expect(page.locator('.output-footnote')).toContainText('草稿已导出');
    expect(readFileSync(exportPath, 'utf8')).toBe(await copied());
    await page.getByRole('button', { name: 'Markdown 编辑', exact: true }).click();
    const original = await page
      .getByRole('textbox', { name: '正文草稿', exact: true })
      .inputValue();
    await page.getByRole('button', { name: '复制正文', exact: true }).click();
    expect(await copied()).toBe(original);
    await page.getByRole('button', { name: '导出草稿', exact: true }).click();
    await expect(page.locator('.output-footnote')).toContainText('草稿已导出');
    expect(readFileSync(exportPath, 'utf8')).toBe(original);
    await page.getByRole('button', { name: '清空当前结果', exact: true }).click();
    await page.getByRole('button', { name: '确认清空当前结果', exact: true }).click();
    await expect(page.locator('.result-state')).toHaveText('等待生成');
    await page.getByRole('button', { name: '恢复刚清空的结果', exact: true }).click();
    await expect(page.locator('.result-state')).toContainText('AI 正式结果');
    await expect(page.getByRole('textbox', { name: '正文草稿', exact: true })).toHaveValue(
      original,
    );
  } finally {
    await app.close();
  }
});

test('O9 streaming keeps previous result, scroll, focus and unchanged Markdown tree', async () => {
  const f = await streamFixture(9);
  const { page } = f;
  try {
    await activate(page.getByRole('button', { name: '撰写求职信', exact: true }));
    await activate(page.getByRole('button', { name: '生成求职信', exact: true }));
    await activate(page.getByRole('button', { name: '确认发送并生成', exact: true }));
    await expect.poll(() => f.posts).toBe(1);
    await expect(page.locator('.result-state')).toContainText('正在生成 · 下方保留原正文');
    await expect(page.locator('.stream-details')).not.toHaveAttribute('open');
    await expect(page.locator('.stream-preview')).toContainText('fixture');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.result-mark .spin')).toHaveCSS('animation-duration', '0s');
    // Explicit user intent establishes the baseline after pre-existing once-per-action feedback.
    await page.locator('#ai-result-letter').evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      el.focus({ preventScroll: true });
    });
    const baseline = await page.evaluate(() => {
      const preview = document.querySelector('.markdown-body')!;
      Object.assign(window, {
        o9Preview: preview.firstChild,
        o9Scroll: scrollY,
        o9Focus: document.activeElement,
      });
      return preview.textContent;
    });
    const first = await page.locator('.stream-preview').textContent();
    await expect.poll(() => page.locator('.stream-preview').textContent()).not.toBe(first);
    expect(await page.locator('.markdown-body').textContent()).toBe(baseline);
    expect(
      await page.evaluate(() => {
        const w = window as unknown as { o9Preview: Node; o9Scroll: number; o9Focus: Element };
        return {
          sameNode: document.querySelector('.markdown-body')!.firstChild === w.o9Preview,
          sameFocus: document.activeElement === w.o9Focus,
          scrollDelta: Math.abs(scrollY - w.o9Scroll),
        };
      }),
    ).toEqual({ sameNode: true, sameFocus: true, scrollDelta: 0 });
    await activate(
      page
        .getByRole('region', { name: '求职信操作反馈', exact: true })
        .getByRole('button', { name: '停止本次生成' }),
    );
    await expect(page.locator('.result-state')).not.toContainText('正在生成');
    expect(f.posts).toBe(1);
  } finally {
    await f.close();
  }
});
