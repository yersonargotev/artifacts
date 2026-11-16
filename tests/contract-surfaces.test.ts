import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { commandOptions } from '../apps/cli/src/index.ts';
import { fixture, grant } from './helpers.ts';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

function missing(surface: string, expected: Iterable<string>, has: (name: string) => boolean) {
  return [...expected].filter((name) => !has(name)).map((name) => `${surface} omits ${name}`);
}

function section(markdown: string, heading: string) {
  const start = markdown.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const end = markdown.indexOf('\n## ', start + heading.length + 2);
  return markdown.slice(start, end === -1 ? undefined : end);
}

function synopses(lines: string[], prefix: string) {
  const byCommand = new Map<string, string>();
  let current: string | undefined;
  for (const line of lines) {
    const command = line.startsWith(prefix) ? /^([a-z]+)/.exec(line.slice(prefix.length))?.[1] : undefined;
    if (command) current = command;
    else if (!/^\s/.test(line)) current = undefined;
    if (current) byCommand.set(current, `${byCommand.get(current) ?? ''} ${line}`);
  }
  return byCommand;
}

function cliGaps(surface: string, byCommand: Map<string, string>) {
  return Object.entries(commandOptions).flatMap(([command, options]) => {
    const synopsis = byCommand.get(command);
    if (synopsis === undefined) return [`${surface} omits command ${command}`];
    return missing(`${surface} for ${command}`, options.map((option) => `--${option}`), (flag) => new RegExp(`${flag}(?![a-z-])`).test(synopsis));
  });
}

test('every MCP tool is documented in the tool contract and the README', async () => {
  const app = await fixture();
  try {
    const { access_token } = await grant(app, 'openid profile artifacts:read artifacts:write artifacts:publish');
    const response = await fetch(app.config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${access_token}`, 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const body = await response.text();
    const { tools } = JSON.parse(body.startsWith('event:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body).result as { tools: { name: string }[] };
    const names = tools.map(({ name }) => name);
    assert.ok(names.length > 0);
    const contract = await text('skills/artifacts/references/tool-contract.md');
    const readme = section(await text('README.md'), '## Call the MCP tools');
    const readmeExempt: Record<string, string> = { whoami: 'README shows identity through the CLI command artifacts whoami' };
    assert.deepEqual([
      ...missing('skills/artifacts/references/tool-contract.md', names, (name) => contract.includes(`| \`${name}\` |`)),
      ...missing('README.md section "Call the MCP tools"', names.filter((name) => !Object.hasOwn(readmeExempt, name)), (name) => readme.includes(`\`${name}\``)),
    ], []);
  } finally { await app.close(); }
});

test('every CLI command and option is documented in the help and the CLI README', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('apps/cli/src/index.ts', root)), '--help']);
  const helpCommands = stdout.slice(stdout.indexOf('\nCommands:\n') + 11).split('\n\n')[0]!.split('\n');
  const readmeBlock = /```text\n([\s\S]*?)```/.exec(section(await text('apps/cli/README.md'), '## Command syntax'))![1]!.split('\n');
  assert.deepEqual([
    ...cliGaps('artifacts --help', synopses(helpCommands, '  ')),
    ...cliGaps('apps/cli/README.md "Command syntax"', synopses(readmeBlock, 'artifacts ')),
  ], []);
});
