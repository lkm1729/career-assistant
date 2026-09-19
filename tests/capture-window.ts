import type { ElectronApplication } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** Hidden Electron windows need a native capture, not a compositor-driven CDP screenshot. */
export async function captureWindow(app: ElectronApplication, path: string) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const capture = await window.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    if (capture.isEmpty()) throw new Error('Electron returned an empty screenshot');
    return capture.toPNG().toString('base64');
  });
  writeFileSync(path, Buffer.from(image, 'base64'));
}
