import { validateDocx } from './docx-validation';
import * as pdfjs from 'pdfjs-dist';
import { renderAsync } from 'docx-preview';
import { createWorker } from 'tesseract.js';
import type { ParsedMaterial, MaterialSheet } from '../shared/materials';
import { materialLimits as limits } from '../shared/materials';
const root = new URL('.', location.href);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', root).href;
let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
const decode = (base64: string) => Uint8Array.from(atob(base64), (x) => x.charCodeAt(0));
async function ocr(image: string) {
  ocrWorker ??= await createWorker(['eng', 'chi_sim'], 1, {
    workerPath: new URL('worker.min.js', root).href,
    corePath: new URL('ocr-core', root).href,
    langPath: new URL('ocr-data', root).href,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: () => {},
    errorHandler: () => {},
  });
  const { data } = await ocrWorker.recognize(image);
  return { text: data.text, confidence: data.confidence };
}
async function addOcr(sheet: MaterialSheet) {
  if (!sheet.image || sheet.text.trim().length >= 40) return;
  try {
    const result = await ocr(sheet.image);
    if (result.text.trim()) sheet.text = result.text;
    sheet.ocr = { confidence: result.confidence };
    if (result.confidence < 65 || !result.text.trim())
      sheet.warnings.push('OCR 置信度较低或未识别文字，请对照原页面确认；不可据此断言原文缺失。');
  } catch {
    sheet.warnings.push('本机 OCR 失败，保留原页面；可手动补充文字，不会改用云端解析。');
  }
}
async function parse(kind: string, base64: string): Promise<ParsedMaterial> {
  const bytes = decode(base64);
  const pages: MaterialSheet[] = [];
  const warnings: string[] = [];
  if (kind === 'pdf') {
    const task = pdfjs.getDocument({
      data: bytes,
      enableXfa: false,
      useSystemFonts: true,
      cMapUrl: new URL('cmaps/', root).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', root).href,
      wasmUrl: new URL('pdf-wasm/', root).href,
    });
    const pdf = await task.promise;
    try {
      for (let n = 1; n <= Math.min(pdf.numPages, limits.pages); n++) {
        const sheet: MaterialSheet = { number: n, text: '', source: 'pdf', warnings: [] };
        pages.push(sheet);
        try {
          const page = await pdf.getPage(n);
          const v = page.getViewport({ scale: 1 });
          const scale = Math.min(1.7, 1800 / Math.max(v.width, v.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          sheet.image = canvas.toDataURL('image/jpeg', 0.88);
          sheet.width = canvas.width;
          sheet.height = canvas.height;
          const text = await page.getTextContent();
          sheet.text = text.items
            .map((x) => ('str' in x ? x.str + (x.hasEOL ? '\n' : ' ') : ''))
            .join('');
          await addOcr(sheet);
          page.cleanup();
        } catch {
          sheet.warnings.push('此页文字抽取或渲染失败；保留可用结果，覆盖不完整。');
        }
      }
      if (pdf.numPages > limits.pages)
        warnings.push(
          `共 ${pdf.numPages} 页，仅解析前 ${limits.pages} 页；其余页面未评价，请拆分后导入。`,
        );
      return { pages, totalPages: pdf.numPages, warnings };
    } finally {
      await task.destroy();
    }
  }
  if (kind === 'docx') {
    validateDocx(bytes);
    const target = document.getElementById('document')!;
    target.replaceChildren();
    await renderAsync(bytes, target, target, {
      inWrapper: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderAltChunks: false,
      renderComments: false,
      useBase64URL: true,
      ignoreFonts: true,
    });
    await document.fonts.ready;
    const sections = [...target.querySelectorAll<HTMLElement>('section.docx')];
    if (!sections.length) throw new Error('DOCX has no rendered pages');
    for (let i = 0; i < Math.min(sections.length, limits.pages); i++)
      pages.push({
        number: i + 1,
        text: sections[i].innerText,
        source: 'docx',
        warnings: [
          'DOCX 近似预览：字体替换、表格与分页可能不同于原文；完整视觉评分请提供原始 PDF 或页面截图。',
        ],
      });
    warnings.push('DOCX 由本地 HTML 排版器渲染，不依赖 Office；并非原始打印版面。');
    if (sections.length > limits.pages)
      warnings.push(`仅预览前 ${limits.pages} 页，部分页面未读取。`);
    return { pages, totalPages: sections.length, warnings };
  }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(kind)) {
    const blob = new Blob([bytes], {
      type: kind === 'jpg' || kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`,
    });
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width * bitmap.height > limits.pixels) {
      bitmap.close();
      throw new Error('image too large');
    }
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(bitmap.width * scale);
    canvas.height = Math.ceil(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const sheet: MaterialSheet = {
      number: 1,
      text: '',
      source: 'image',
      image: canvas.toDataURL('image/jpeg', 0.9),
      width: canvas.width,
      height: canvas.height,
      warnings: [],
    };
    if (Math.min(canvas.width, canvas.height) < 500)
      sheet.warnings.push('页面像素较低，可能模糊；请补充清晰原图。');
    await addOcr(sheet);
    return { pages: [sheet], totalPages: 1, warnings };
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('binary input');
  return { pages: [{ number: 1, text, source: 'text', warnings: [] }], totalPages: 1, warnings };
}
async function focusDocxPage(number: number) {
  const sections = [...document.querySelectorAll<HTMLElement>('section.docx')];
  const section = sections[number - 1];
  if (!section) throw new Error('missing page');
  sections.forEach((s) => (s.style.display = s === section ? 'block' : 'none'));
  window.scrollTo(0, 0);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const rect = section.getBoundingClientRect();
  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.ceil(rect.width),
    height: Math.ceil(Math.max(rect.height, section.scrollHeight)),
  };
}
Object.assign(window, { parseMaterial: parse, focusDocxPage });
