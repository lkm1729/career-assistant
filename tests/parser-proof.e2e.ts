import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
test('bundled parser loads and performs English/Chinese OCR entirely offline', async () => {
  test.setTimeout(180000);
  mkdirSync('.test-data', { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: mkdtempSync(resolve('.test-data/parser-proof-')),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
    env,
  });
  try {
    const appRoot = await app.evaluate(({ app }) => app.getAppPath());
    const result = await app.evaluate(
      async ({ BrowserWindow, session }, path) => {
        const isolated = session.fromPartition('parser-proof');
        let remote = 0;
        isolated.webRequest.onBeforeRequest((details, cb) => {
          if (/^https?:/.test(details.url)) {
            remote++;
            cb({ cancel: true });
          } else cb({});
        });
        const win = new BrowserWindow({
          show: false,
          width: 1000,
          height: 1000,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            session: isolated,
            backgroundThrottling: false,
          },
        });
        try {
          await win.loadFile(path);
          const value = await win.webContents.executeJavaScript(
            `(async()=>{const c=document.createElement('canvas');c.width=1200;c.height=600;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,1200,600);x.fillStyle='black';x.font='60px Arial';x.fillText('CAREER RESUME 2026',60,160);x.fillText('Software engineer',60,260);x.font='60px Microsoft YaHei';x.fillText('软件工程师 简历',60,380);return await window.parseMaterial('png',c.toDataURL('image/png').split(',')[1]);})()`,
          );
          return { value, remote };
        } finally {
          win.destroy();
        }
      },
      resolve(appRoot, 'dist-electron/parser/index.html'),
    );
    expect(result.remote).toBe(0);
    expect(result.value.pages[0].text).toMatch(/CAREER|RESUME/);
    expect(result.value.pages[0].text.replace(/\s/g, '')).toMatch(/工程|简历/);
    expect(result.value.pages[0].ocr).toBeTruthy();
  } finally {
    await app.close();
  }
});
