import { BrowserWindow, session } from 'electron';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AiError } from '../shared/ai';
import type { ParsedMaterial } from '../shared/materials';
export async function parseMaterial(
  kind: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<ParsedMaterial> {
  const assetRoot = resolve(__dirname, 'parser');
  const isolated = session.fromPartition('material-' + randomUUID());
  isolated.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, cb) => {
    let allowed = /^(data|blob):/.test(details.url);
    if (details.url.startsWith('file:')) {
      try {
        const p = resolve(fileURLToPath(details.url));
        allowed = p.startsWith(assetRoot + sep);
      } catch {
        allowed = false;
      }
    }
    cb({ cancel: !allowed });
  });
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: isolated,
      backgroundThrottling: false,
      devTools: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  const abort = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 150000);
  try {
    signal.throwIfAborted();
    await win.loadFile(join(assetRoot, 'index.html'));
    const result: ParsedMaterial = await win.webContents.executeJavaScript(
      `window.parseMaterial(${JSON.stringify(kind)},${JSON.stringify(bytes.toString('base64'))})`,
    );
    if (kind === 'docx')
      for (const sheet of result.pages) {
        try {
          let rect = await win.webContents.executeJavaScript(
            `window.focusDocxPage(${sheet.number})`,
          );
          if (rect.width > 1800 || rect.height > 2600 || rect.width < 1 || rect.height < 1) {
            sheet.warnings.push('此页近似排版超出预览尺寸，未生成图像；请转换 PDF。');
            continue;
          }
          win.setContentSize(Math.max(900, rect.width + 20), Math.max(1000, rect.height + 20));
          rect = await win.webContents.executeJavaScript(`window.focusDocxPage(${sheet.number})`);
          const image = await win.webContents.capturePage(rect, {
            stayHidden: true,
            stayAwake: true,
          });
          if (image.isEmpty()) throw new Error();
          sheet.image = 'data:image/jpeg;base64,' + image.toJPEG(88).toString('base64');
          sheet.width = rect.width;
          sheet.height = rect.height;
        } catch {
          sheet.warnings.push('DOCX 页面预览失败，保留抽取文字；请转换 PDF 后重试。');
        }
      }
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) throw new AiError('已取消本地解析；已完成的资料保留。');
    if (error instanceof AiError) throw error;
    throw new AiError(
      '本地解析失败或超时：文件可能损坏、加密、格式不符或资源超限。可转换 PDF / UTF-8 文本或清晰截图重试。',
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    abort();
  }
}
