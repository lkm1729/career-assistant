import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
// Release binaries intentionally disable inspectors. Full UI coverage lives in tests/*.e2e.ts.
// This smoke uses normal Windows window-close messages; no CDP port or forced process kill.
const config = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (!args.includes('--show-window')) {
  console.error(
    'Explicit visible-window consent required: node scripts/smoke-packaged.mjs --show-window [executable]',
  );
  process.exitCode = 2;
} else {
  const executable =
    args.find((arg) => arg !== '--show-window') ??
    join(config.build.directories.output, 'win-unpacked', 'Career Assistant.exe');
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      resolve('scripts/smoke-packaged.ps1'),
      '-ShowWindow',
      '-ExecutablePath',
      resolve(executable),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
