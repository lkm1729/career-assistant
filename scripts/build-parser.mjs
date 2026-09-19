import { build } from 'esbuild';
import { mkdirSync, cpSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const out = 'dist-electron/parser';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['electron/parser-renderer.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome140',
  outfile: join(out, 'parser.js'),
});
copyFileSync('electron/parser.html', join(out, 'index.html'));
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.mjs', join(out, 'pdf.worker.mjs'));
for (const [from, to] of [
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
  ['wasm', 'pdf-wasm'],
])
  cpSync('node_modules/pdfjs-dist/' + from, join(out, to), { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', join(out, 'worker.min.js'));
mkdirSync(join(out, 'ocr-core'), { recursive: true });
for (const f of readdirSync('node_modules/tesseract.js-core'))
  if (f.endsWith('.wasm.js'))
    copyFileSync(join('node_modules/tesseract.js-core', f), join(out, 'ocr-core', f));
mkdirSync(join(out, 'ocr-data'), { recursive: true });
for (const lang of ['eng', 'chi_sim'])
  copyFileSync(
    `node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`,
    join(out, 'ocr-data', `${lang}.traineddata.gz`),
  );
mkdirSync(join(out, 'licenses'), { recursive: true });
for (const dep of [
  'pdfjs-dist',
  'docx-preview',
  'tesseract.js',
  'tesseract.js-core',
  'fflate',
  'jszip',
])
  for (const f of readdirSync('node_modules/' + dep))
    if (/^licen[sc]e/i.test(f))
      cpSync(join('node_modules', dep, f), join(out, 'licenses', dep + '-' + f));

copyFileSync(
  'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',
  join(out, 'worker.min.js.LICENSE.txt'),
);
