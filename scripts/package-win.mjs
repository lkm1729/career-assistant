import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** NSIS uses the public four-part version, while package.json remains valid SemVer.
 * This is the builder's option hook, not a patched dependency or a post-sign EXE rewrite.
 */
export function applyInstallerReleaseVersion(options, version) {
  assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
  if (!Array.isArray(options) || !options[0]?.VERSION) return false;
  const [defines, commands] = options;
  assert.ok(Array.isArray(commands.VIAddVersionKey));
  const keys = commands.VIAddVersionKey;
  assert.equal(keys.filter((key) => /\sProductVersion\s"/.test(key)).length, 1);
  defines.VERSION = version;
  commands.VIAddVersionKey = keys.map((key) =>
    key.replace(/(\sProductVersion\s)"[^"]*"$/, '$1"' + version + '"'),
  );
  return false;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = metadata.build.buildVersion ?? metadata.version;
  const { build, Platform, Arch } = await import('electron-builder');
  await build({
    targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
    publish: 'never',
    config: { npmRebuild: false },
    effectiveOptionComputed: (options) => applyInstallerReleaseVersion(options, version),
  });
}
