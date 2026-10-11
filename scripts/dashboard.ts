import { spawn } from 'node:child_process';

process.loadEnvFile();
const url = new URL(process.env.DASHBOARD_URL!);
const child = spawn('pnpm', ['--filter', '@artifacts/dashboard', 'dev', '--host', '127.0.0.1', '--port', url.port || '4321'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
