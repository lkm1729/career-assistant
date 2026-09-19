import { applyInstallerReleaseVersion } from '../scripts/package-win.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appVersion } from '../shared/version';
import pkg from '../package.json';
import lock from '../package-lock.json';
test('release metadata and every current UI label use one package version', () => {
  assert.equal(appVersion, pkg.build.buildVersion);
  assert.match(appVersion, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
  const hotfix = appVersion.split('.').length === 4;
  assert.equal(pkg.version, hotfix ? appVersion.replace(/\.(\d+)$/, '+$1') : appVersion);
  assert.equal(
    Reflect.get(pkg.build, 'buildNumber'),
    hotfix ? appVersion.split('.')[3] : undefined,
  );
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[''].version);
  assert.equal(pkg.build.directories.output, `release/${appVersion}`);
  for (const file of readdirSync('src', { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|html)$/.test(f))) {
    const s = readFileSync(join('src', file), 'utf8');
    assert.ok(!/\b0\.\d+\.\d+\b/.test(s), `Hard-coded UI release in ${file}`);
  }
  for (const file of ['src/App.tsx', 'src/controls.tsx'])
    assert.match(readFileSync(file, 'utf8'), /appVersion/);
});

test('NSIS branding and registration use the public release, without changing package or file version', () => {
  const options = [
    { VERSION: pkg.version, UNINSTALL_DISPLAY_NAME: 'Career Assistant ' + appVersion },
    {
      VIProductVersion: appVersion,
      VIAddVersionKey: [
        '/LANG=1033 ProductVersion "' + pkg.version + '"',
        '/LANG=1033 FileVersion "' + appVersion + '"',
      ],
    },
  ];
  applyInstallerReleaseVersion(options, appVersion);
  assert.equal(options[0].VERSION, appVersion);
  assert.deepEqual(options[1].VIAddVersionKey, [
    '/LANG=1033 ProductVersion "' + appVersion + '"',
    '/LANG=1033 FileVersion "' + appVersion + '"',
  ]);
  assert.equal(options[1].VIProductVersion, appVersion);
  assert.match(pkg.scripts.package, /scripts\/package-win\.mjs/);
  assert.match(pkg.build.artifactName, /\$\{buildVersion\}/);
  assert.match(pkg.build.nsis.artifactName, /\$\{buildVersion\}/);
});
