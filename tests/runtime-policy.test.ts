import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { rendererLocation, releaseDebugSwitches } from '../electron/runtime-policy.js';

test('release renderer ignores every dev URL; development only trusts the exact local server', () => {
  const bundled = 'file:///D:/app/resources/app.asar/dist/index.html';
  for (const url of [
    undefined,
    'http://127.0.0.1:5173',
    'https://example.invalid',
    'http://127.0.0.1:5173/other',
  ]) {
    assert.equal(rendererLocation(true, url, bundled), bundled);
  }
  assert.equal(rendererLocation(false, 'http://127.0.0.1:5173', bundled), 'http://127.0.0.1:5173');
  assert.equal(rendererLocation(false, 'https://example.invalid', bundled), bundled);
  assert.deepEqual(releaseDebugSwitches, ['remote-debugging-port', 'remote-debugging-pipe']);
});

test('release configuration removes unused privilege helper and Node execution/inspection entry points', () => {
  const { build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(build.win.target, [
    { target: 'nsis', arch: ['x64'] },
    { target: 'zip', arch: ['x64'] },
  ]);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.allowElevation, false);
  assert.equal(build.nsis.packElevateHelper, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.runAfterFinish, false);
  assert.equal(build.win.requestedExecutionLevel, 'asInvoker');
  assert.deepEqual(build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  });
  assert.deepEqual(build.files, ['dist/**/*', 'dist-electron/**/*', 'package.json']);
});
