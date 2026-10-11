import { spawn } from 'node:child_process';

const children = ['apps/auth/src/server.ts', 'apps/mcp/src/server.ts', 'scripts/dashboard.ts'].map((path) => spawn(process.execPath, ['--import', 'tsx', path], { stdio: 'inherit', detached: process.platform !== 'win32' }));
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(0));
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
