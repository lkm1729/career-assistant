import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
function payloads(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[]
      ).map(({ name }) => [
        name,
        db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all(),
      ]),
    );
  } finally {
    db.close();
  }
}
test('P14 actual retained release data and encrypted provider key survive current package upgrade and restart offline', async () => {
  test.setTimeout(180000);
  const old = resolve(
    process.env.CAREER_E2E_UPGRADE_FROM ?? 'release/0.11.1/win-unpacked/resources/app.asar',
  );
  expect(existsSync(old), 'Retain actual previous release as upgrade fixture').toBe(true);
  const next = resolve(process.env.CAREER_E2E_APP_PATH ?? '.');
  mkdirSync('.test-data', { recursive: true });
  const data = mkdtempSync(resolve('.test-data/p14-upgrade-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const launch = async (path: string) => {
    const app = await electron.launch({ executablePath: require('electron'), args: [path], env });
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
    return { app, page };
  };
  let { app, page } = await launch(old);
  try {
    const replies = await page.evaluate(async () => {
      const api = window.career!;
      const snapshot = await api.load();
      // The currently displayed resume draft is seeded through UI below; other pages use the same bridge.
      for (const id of ['score', 'match', 'letter'] as const) {
        await api.saveWorkspace(id, {
          ...snapshot.workspaces[id],
          prompt: 'P14 ' + id,
          document: '# Old ' + id,
          links: id === 'match' ? 'https://example.com/old-job' : '',
        });
        await api.prompts.save(id, 'P14 saved prompt', 'P14 ' + id + ' isolated system');
      }
      const material = await api.materials.importText('match', 'job', {
        title: 'Old public source',
        text: 'Fictional engineering job with documented testing and reliable software development.',
        sourceUrl: 'https://example.com/job',
      });
      const provider = await api.ai.registry.saveProvider({
        name: 'P14 fake provider',
        baseUrl: 'https://example.com/v1',
        apiKey: 'FAKE-P14-KEY-NOT-A-REAL-SECRET',
        protocol: 'chat-completions',
      });
      return { material: material.ok, provider: provider.ok };
    });
    expect(replies).toEqual({ material: true, provider: true });
    await page.locator('#user-prompt').fill('P14 resume manual draft');
    await app.close();
    const baseline = payloads(join(data, 'workspace.sqlite'));
    expect(JSON.stringify(baseline)).not.toContain('FAKE-P14-KEY-NOT-A-REAL-SECRET');
    for (let run = 0; run < 2; run++) {
      ({ app, page } = await launch(next));
      await expect(page.locator('#user-prompt')).toHaveValue('P14 resume manual draft');
      const snapshot = await page.evaluate(() => window.career!.load());
      expect(snapshot.workspaces.letter.prompt).toBe('P14 letter');
      expect(await page.evaluate(() => window.career!.prompts.list('match'))).toHaveLength(1);
      expect(await page.evaluate(() => window.career!.materials.list('match'))).toHaveLength(1);
      const secretOk = await app.evaluate(
        ({ safeStorage }, dbPath) => {
          const { DatabaseSync } = process.getBuiltinModule(
            'node:sqlite',
          ) as typeof import('node:sqlite');
          const db = new DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db.prepare('SELECT encrypted_key FROM ai_providers').get();
            return (
              safeStorage.decryptString(Buffer.from(row!.encrypted_key as Uint8Array)) ===
              'FAKE-P14-KEY-NOT-A-REAL-SECRET'
            );
          } finally {
            db.close();
          }
        },
        join(data, 'workspace.sqlite'),
      );
      expect(secretOk).toBe(true);
      await app.close();
      const upgraded = payloads(join(data, 'workspace.sqlite'));
      // O4 adds an empty local result-state table. Existing rows (including encrypted
      // keys, drafts, materials and history) must still compare byte-for-byte.
      if (!Object.hasOwn(baseline, 'workbench_results')) {
        expect(upgraded.workbench_results).toEqual([]);
        delete upgraded.workbench_results;
      }
      expect(upgraded).toEqual(baseline);
    }
  } finally {
    await app.close();
  }
});

test('P14 packaged fonts load offline and four tabs render without online font downloads', async ({}, info) => {
  mkdirSync('.test-data', { recursive: true });
  const data = mkdtempSync(resolve('.test-data/p14-font-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: data,
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
    await page.context().setOffline(true);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = await document.fonts.load('400 16px "Google Sans"', 'Career 2026');
      return {
        count: loaded.length,
        ok: loaded.every((f) => f.status === 'loaded'),
        family: getComputedStyle(document.documentElement).fontFamily,
      };
    });
    expect(fonts.count).toBeGreaterThan(0);
    expect(fonts.ok).toBe(true);
    expect(fonts.family).toContain('Google Sans');
    for (const name of ['设计简历', '简历评分', '岗位匹配', '撰写求职信']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('region', { name: '本页附件资料', exact: true })).toHaveCount(1);
    }
    await captureWindow(app, info.outputPath('p14-bundled-fonts.png'));
  } finally {
    await app.close();
  }
});
