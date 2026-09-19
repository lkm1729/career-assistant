import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import './build-electron.mjs';
const server = await createServer();
await server.listen();
const env = { ...process.env, CAREER_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => stop(code ?? 0));
child.on('error', (error) => {
  console.error(error);
  void stop(1);
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
