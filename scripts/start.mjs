import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env };
for (const key of [
  'ELECTRON_RUN_AS_NODE',
  'CAREER_TEST_MODE',
  'CAREER_TEST_DATA',
  'CAREER_DEV_URL',
])
  delete env[key];
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
child.on('error', (error) => {
  console.error('Could not start Career Assistant:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
