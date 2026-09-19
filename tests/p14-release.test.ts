import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('P14 bundles unmodified Google Sans with provenance and does not relicense MiSans', () => {
  const meta = JSON.parse(readFileSync('vendor/fonts.json', 'utf8'));
  assert.equal(meta.googleSans.license, 'SIL OFL-1.1');
  assert.equal(meta.miSans.bundled, false);
  for (const font of meta.googleSans.files)
    assert.equal(
      createHash('sha256')
        .update(readFileSync('public/fonts/' + font.file))
        .digest('hex'),
      font.sha256,
    );
  assert.match(readFileSync('vendor/licenses/GoogleSans-OFL.txt', 'utf8'), /SIL OPEN FONT LICENSE/);
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /@font-face/);
  assert.doesNotMatch(css, /@import[^;]*https?:|url\(['"]?https?:/);
});
test('P14 license inventory retains texts and explicitly flags upstream gaps', () => {
  const report = JSON.parse(readFileSync('build/third-party/INVENTORY.json', 'utf8'));
  assert.ok(report.entries.length > 100);
  for (const item of report.entries) {
    for (const name of item.notices) assert.ok(existsSync('build/third-party/' + name));
    if (!item.notices.length)
      assert.ok(report.reviewRequired.some((r: { name: string }) => r.name === item.name));
  }
  assert.ok(existsSync('build/third-party/FONT-NOTICE.txt'));
  assert.ok(existsSync('build/third-party/pdfjs-standard_fonts-LICENSE_LIBERATION'));
});
test('P14 installer preserves app identity and data and refuses process termination', () => {
  const { build } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(build.appId, 'com.careerassistant.desktop');
  assert.equal(build.nsis.oneClick, true);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  const script = readFileSync('build/installer.nsh', 'utf8');
  assert.match(script, /customCheckAppRunning/);
  assert.match(script, /FindProcess/);
  assert.doesNotMatch(script, /KillProcess|taskkill|Stop-Process|RMDir|DeleteRegKey/);
  assert.match(script, /customUnInit/);
  assert.match(script, /--delete-app-data/);
  assert.ok(build.extraResources.some((r: { to: string }) => r.to === 'licenses'));
});
