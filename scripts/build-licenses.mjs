import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve('.');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
const releaseVersion = metadata.build.buildVersion ?? metadata.version;
const out = 'build/third-party';
mkdirSync(out, { recursive: true });
const entries = [];
const review = [];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev || !existsSync(join(path, 'package.json'))) continue;
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const slug = (pkg.name + '@' + pkg.version).replaceAll('/', '__');
  let files = readdirSync(path).filter((n) =>
    /^(licen[cs]e|copying|notice|authors)(?:[._-]|$)/i.test(n),
  );
  const notices = [];
  for (const name of files) {
    const input = join(path, name);
    if (!readFileSafe(input)) continue;
    const output = slug + '-' + name;
    copyFileSync(input, join(out, output));
    notices.push(output);
  }
  if (!notices.length && existsSync(join(path, 'README.md'))) {
    const text = readFileSync(join(path, 'README.md'), 'utf8');
    const at = text.search(/^##? License\s*$/im);
    if (at >= 0 && text.slice(at).includes('Permission is hereby granted')) {
      const output = slug + '-LICENSE-from-README.txt';
      writeFileSync(join(out, output), text.slice(at));
      notices.push(output);
    }
  }
  if (!notices.length && pkg.name === '@napi-rs/canvas-win32-x64-msvc') {
    const output = slug + '-LICENSE.txt';
    copyFileSync('node_modules/@napi-rs/canvas/LICENSE', join(out, output));
    notices.push(output);
  }
  if (!notices.length) {
    review.push({
      name: pkg.name,
      version: pkg.version,
      issue:
        'Installed npm archive declares ' +
        pkg.license +
        ' but contains no full license text; upstream supplemental notices are included separately. Do not interpret this inventory as a legal clearance.',
    });
  }
  entries.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? 'UNKNOWN',
    source: pkg.repository?.url ?? pkg.repository ?? pkg.homepage ?? '',
    notices,
  });
}
function readFileSafe(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
for (const file of readdirSync('vendor/licenses'))
  copyFileSync(join('vendor/licenses', file), join(out, file));
copyFileSync('vendor/fonts.json', join(out, 'fonts.json'));
for (const sub of ['standard_fonts', 'wasm'])
  for (const file of readdirSync('node_modules/pdfjs-dist/' + sub).filter((x) =>
    /^license/i.test(x),
  ))
    copyFileSync(
      join('node_modules/pdfjs-dist', sub, file),
      join(out, 'pdfjs-' + sub + '-' + file),
    );
copyFileSync('node_modules/electron/LICENSE', join(out, 'Electron-LICENSE.txt'));
writeFileSync(
  join(out, 'FONT-NOTICE.txt'),
  `Google Sans v14.000 is bundled unmodified under SIL OFL 1.1; see GoogleSans-OFL.txt and GoogleSans-TRADEMARKS.txt. No Google affiliation or endorsement is implied.\nMiSans font files are NOT redistributed. If the user has installed MiSans under Xiaomi's license, the app prefers that local font for Chinese. Otherwise Windows system fonts are used offline. Official source: https://hyperos.mi.com/font/zh/download/ . MiSans has its own custom license and is not claimed to be OFL or MIT.\nPDF rendering fonts have separate Foxit/Liberation notices included here.\n`,
);
writeFileSync(
  join(out, 'INVENTORY.json'),
  JSON.stringify(
    {
      version: releaseVersion,
      platform: 'win32-x64',
      generatedFrom: 'package-lock.json installed production dependency closure',
      entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
      reviewRequired: review,
    },
    null,
    2,
  ) + '\n',
);
const report = [
  'THIRD-PARTY SOFTWARE NOTICES — Career Assistant ' + releaseVersion,
  '',
  'This inventory preserves license texts shipped with installed npm packages and supplemental upstream notices. It is not a grant of rights for Career Assistant itself. Electron/Chromium bundled notices are also shipped as LICENSE.electron.txt and LICENSES.chromium.html beside the EXE. Native/OCR data upstream licenses are included; see provenance.json.',
  '',
  ...entries.map(
    (e) =>
      `${e.name} ${e.version} — ${e.license}\n  ${e.notices.join(', ') || 'See reviewRequired in INVENTORY.json'}`,
  ),
  '',
  'REVIEW REQUIRED BEFORE PUBLIC DISTRIBUTION',
  ...review.map((e) => e.name + ': ' + e.issue),
  '',
  'Career Assistant source code is licensed under MIT (see the repository LICENSE); bundled third-party materials follow their own licenses and notices.',
];
writeFileSync(join(out, 'THIRD-PARTY-NOTICES.txt'), report.join('\n') + '\n');
const hashes = Object.fromEntries(
  readdirSync(out)
    .filter((f) => f !== 'HASHES.json')
    .map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(join(out, f)))
        .digest('hex'),
    ]),
);
writeFileSync(join(out, 'HASHES.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(
  `Third-party inventory: ${entries.length} installed packages; ${review.length} upstream license-text gaps explicitly recorded; font and renderer notices included.`,
);
