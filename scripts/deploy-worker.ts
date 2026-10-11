import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [service, ...args] = process.argv.slice(2);
if (!service || !['auth', 'mcp', 'panel', 'view'].includes(service)) throw new Error('Select auth, mcp, panel, or view');
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(root, 'dist/workers', service);
await access(resolve(directory, '.cloudflare/output/v0/config.json'));
const forwarded = args.map((value, index) => args[index - 1] === '--secrets-file' ? resolve(value) : value);
const child = spawn('cf', ['deploy', '--prebuilt', ...forwarded], { cwd: directory, stdio: 'inherit' });
child.on('error', (error) => { throw error; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
