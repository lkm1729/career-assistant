import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { listPackage, extractFile } from '@electron/asar';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
const config = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseVersion = config.build.buildVersion ?? config.version;
const directory = resolve(process.argv[2] ?? join(config.build.directories.output, 'win-unpacked'));
const wire = await getCurrentFuseWire(join(directory, 'Career Assistant.exe'));
for (const option of [
  FuseV1Options.RunAsNode,
  FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  FuseV1Options.EnableNodeCliInspectArguments,
])
  assert.equal(wire[option], 48);
for (const option of [
  FuseV1Options.OnlyLoadAppFromAsar,
  FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
])
  assert.equal(wire[option], 49);
assert.equal(existsSync(join(directory, 'resources/elevate.exe')), false);
const asar = join(directory, 'resources/app.asar');
const entries = listPackage(asar).map((name) => name.replaceAll('\\', '/'));
assert.ok(entries.some((name) => name.endsWith('/dist-electron/main.cjs')));
assert.equal(
  entries.some((name) => /^\/(scripts|tests|\.test-data|\.npm-cache)(\/|$)/.test(name)),
  false,
);
// Runtime profiles belong outside the distributable, even when an existing local
// installation contains encrypted supplier settings and interview history.
const privateFile =
  /^(?:workspace\.sqlite(?:-wal|-shm)?|\.env(?:\..+)?|credentials?\.json|api[-_]?keys?\.json)$/i;
assert.equal(
  entries.some((name) => privateFile.test(name.split('/').at(-1))),
  false,
  'ASAR must not include runtime credentials or records',
);
for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
  if (entry.isFile())
    assert.equal(
      privateFile.test(entry.name),
      false,
      'Private runtime file in release: ' + entry.name,
    );
}
// Version numbers alone cannot detect an interrupted same-version rebuild.
// Pass native paths to ASAR: nested archive entries use platform separators.
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
for (const directoryName of ['dist', 'dist-electron']) {
  const buildDirectory = join(projectRoot, directoryName);
  for (const entry of readdirSync(buildDirectory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const archivePath = relative(projectRoot, file);
    assert.ok(
      readFileSync(file).equals(extractFile(asar, archivePath)),
      `Stale packaged build: ${archivePath}`,
    );
  }
}
const metadata = JSON.parse(extractFile(asar, 'package.json').toString());
assert.equal(metadata.version, config.version);
// electron-builder strips build config from packaged metadata; UI was compiled from buildVersion.
assert.equal(metadata.version.replace(/\+(\d+)$/, '.$1'), releaseVersion);
console.log(
  'Release artifact PASS: app-only fuses, ASAR integrity, no elevate.exe, no test scripts/data, matching build content, version ' +
    releaseVersion,
);

const notices = join(directory, 'resources/licenses');
const inventory = JSON.parse(readFileSync(join(notices, 'INVENTORY.json'), 'utf8'));
assert.equal(inventory.version, releaseVersion);
const hashes = JSON.parse(readFileSync(join(notices, 'HASHES.json'), 'utf8'));
const { createHash } = await import('node:crypto');
for (const [name, hash] of Object.entries(hashes))
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(notices, name)))
      .digest('hex'),
    hash,
    name,
  );
for (const name of ['fonts/GoogleSans.ttf', 'fonts/GoogleSans-Italic.ttf'])
  assert.ok(extractFile(asar, join('dist', name)).length > 100000);
for (const name of ['eng', 'chi_sim'])
  assert.ok(
    extractFile(asar, join('dist-electron/parser/ocr-data', name + '.traineddata.gz')).length >
      100000,
  );
assert.ok(existsSync(join(directory, 'LICENSE.electron.txt')));
assert.ok(existsSync(join(directory, 'LICENSES.chromium.html')));
assert.ok(existsSync(join(directory, 'DISTRIBUTION-NOTES.txt')));
console.log(
  'P14 resources PASS: offline fonts/OCR, license inventory and notice hashes; review gaps remain explicit.',
);
