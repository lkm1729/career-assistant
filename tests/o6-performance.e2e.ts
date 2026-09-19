import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fixture, measure, activate, type Sample } from './o6-performance-fixture';
for (const size of [9, 500])
  test(`O6 performance ${size} models`, async ({}, info) => {
    test.setTimeout(240000);
    const f = await fixture(size);
    const { page } = f;
    const samples: Sample[] = [];
    const run = async (name: string, action: () => Promise<unknown>) => {
      samples.push(await measure(page, name, action));
    };
    try {
      for (let repeat = 0; repeat < 3; repeat++) {
        await run('settings-open', async () => {
          await activate(page.getByRole('button', { name: '应用设置', exact: true }));
          await expect(
            page.getByRole('button', { name: '管理 Perf 0', exact: true }),
          ).toBeVisible();
        });
        for (const p of [1, 0, 1, 0])
          await run('provider-switch', async () => {
            await activate(page.getByRole('button', { name: `管理 Perf ${p}`, exact: true }));
            await expect(page.locator('.provider-row.selected')).toContainText(`Perf ${p}`);
            await expect(
              page.getByRole('button', { name: `编辑模型 Perf Model ${p}`, exact: true }),
            ).toBeAttached();
            await expect(
              page.getByRole('button', { name: `编辑模型 Perf Model ${1 - p}`, exact: true }),
            ).toHaveCount(0);
          });
        await run('editor-open', async () => {
          await activate(page.getByRole('button', { name: '编辑模型 Perf Model 0', exact: true }));
          await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('perf-0');
        });
        await run('editor-input', () =>
          page.getByLabel('模型显示名称', { exact: true }).fill('Unsaved fixture edit'),
        );
        await run('editor-close', () =>
          activate(page.getByRole('button', { name: '取消编辑并返回列表', exact: true })),
        );
        await activate(page.getByRole('button', { name: '完成', exact: true }));
      }
      for (const [name, button] of [
        ['设计简历', '生成简历'],
        ['简历评分', '开始评分'],
        ['岗位匹配', '评估匹配度'],
        ['撰写求职信', '生成求职信'],
      ]) {
        await activate(page.getByRole('button', { name, exact: true }));
        await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
        for (let repeat = 0; repeat < 3; repeat++) {
          await run(`confirm-${name}`, async () => {
            await activate(page.getByRole('button', { name: button, exact: true }));
            await expect(page.getByRole('dialog')).toBeVisible();
          });
          await expect(page.getByRole('dialog')).not.toContainText('-private-');
          await activate(page.getByRole('button', { name: '返回修改', exact: true }));
        }
      }
      expect(f.posts).toBe(0);
      await activate(page.getByRole('button', { name: '生成求职信', exact: true }));
      await activate(page.getByRole('button', { name: '确认发送并生成', exact: true }));
      await expect.poll(() => f.posts).toBe(1);
      await run('stream-settings', async () => {
        await activate(page.getByRole('button', { name: '应用设置', exact: true }));
        await page.waitForTimeout(2400);
      });
      await activate(page.getByRole('button', { name: '完成', exact: true }));
      await activate(
        page
          .getByRole('region', { name: '求职信操作反馈', exact: true })
          .getByRole('button', { name: '停止本次生成' }),
      );
      await expect(
        page.getByRole('region', { name: '求职信操作反馈', exact: true }),
      ).toHaveAttribute('data-pending', 'false');
      expect(f.posts).toBe(1);
    } finally {
      writeFileSync(
        info.outputPath('performance.json'),
        JSON.stringify({ size, cpu: cpus()[0]?.model, samples }, null, 2),
      );
      console.log(
        'O6',
        size,
        JSON.stringify(
          samples.map((s) => ({
            name: s.name,
            elapsed: Math.round(s.elapsed),
            longest: Math.round(Math.max(0, ...s.longTasks)),
            nodes: s.nodes,
          })),
        ),
      );
      await f.close();
    }
    // Explicit capture-only mode; normal runs enforce the renderer responsiveness budget.
    if (process.env.CAREER_PERF_CAPTURE !== '1') {
      for (const name of new Set(samples.map((s) => s.name))) {
        const maxima = samples
          .filter((s) => s.name === name)
          .map((s) => Math.max(0, ...s.longTasks))
          .sort((a, b) => a - b);
        expect(
          maxima[Math.floor(maxima.length / 2)],
          `${name}: median longest renderer task`,
        ).toBeLessThan(100);
        if (size === 500 && ['confirm-设计简历', 'confirm-撰写求职信'].includes(name)) {
          const elapsed = samples
            .filter((s) => s.name === name)
            .map((s) => s.elapsed)
            .sort((a, b) => a - b);
          expect(
            elapsed[Math.floor(elapsed.length / 2)],
            `${name}: median action-to-two-frames`,
          ).toBeLessThan(230);
        }
      }
    }
  });
