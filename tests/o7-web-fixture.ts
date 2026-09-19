import { expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
export function dataDir() {
  mkdirSync('.test-data', { recursive: true });
  return mkdtempSync(resolve('.test-data/o7-desktop-'));
}
export async function launch(dir: string) {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  return { app, page };
}
// Only the external DNS/HTTPS boundary is replaced. Real URL guards, IPC, parser and storage run.
export async function offlineWeb(app: ElectronApplication) {
  await app.evaluate(() => {
    const dns = process.getBuiltinModule('node:dns/promises') as typeof import('node:dns/promises');
    const https = process.getBuiltinModule('node:https') as typeof import('node:https');
    const { EventEmitter } = process.getBuiltinModule(
      'node:events',
    ) as typeof import('node:events');
    const { Readable } = process.getBuiltinModule('node:stream') as typeof import('node:stream');
    const calls: string[] = [];
    Object.assign(globalThis, { o7WebCalls: calls });
    dns.lookup = (async (host: string) => {
      if (host !== 'portfolio.example.com') throw Error('No external DNS permitted');
      return [{ address: '8.8.8.8', family: 4 }];
    }) as unknown as typeof dns.lookup;
    https.request = ((
      options: { servername: string; path: string },
      callback: (res: unknown) => void,
    ) => {
      const req = new EventEmitter() as import('node:events').EventEmitter & { end: () => void };
      req.end = () => {
        if (options.servername !== 'portfolio.example.com') {
          req.emit('error', Error('No external network permitted'));
          return;
        }
        calls.push(options.path);
        const response = Readable.from([
          Buffer.from(
            '<title>Fixture ' +
              options.path +
              '</title><p>Fictional TypeScript engineer project: built accessible interfaces, automated tests and services.</p>',
          ),
        ]);
        Object.assign(response, {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
        callback(response);
      };
      return req;
    }) as typeof https.request;
  });
}
export async function webCalls(app: ElectronApplication) {
  return app.evaluate(() => Reflect.get(globalThis, 'o7WebCalls') as string[]);
}
