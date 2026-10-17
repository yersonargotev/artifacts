#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createSchema, moveSchema, publishSchema, updateSchema } from '@yargote/artifacts-contracts';
import { canonicalResource } from '@yargote/artifacts-contracts/http';
import { createArtifactHttpClient, HttpError, prepareArtifactEdit } from '@yargote/artifacts-client';
import { accessToken, login, logout } from './auth.ts';
import { loadOperation, retainOperation, submitOperation, type Mutation } from './operations.ts';
import { runSkillsCommand } from './skills.ts';

const help = `Usage: artifacts COMMAND [OPTIONS]

Global options:
  --server RESOURCE       Canonical OAuth resource, or ARTIFACTS_SERVER
  --state-dir DIR         Private local state, or ARTIFACTS_STATE_DIR
                         Default: ~/.local/state/artifacts
  --help                 Print this reference
  --version              Print the installed package version

Commands:
  skills [list]
  skills get NAME [--full]
  skills get --all [--full]
  skills path [NAME]
  skills install [NAME] [--agent claude] [--global] [--force]
  login [--no-browser]
  logout
  whoami
  create --snapshot FILE [--project NAME] [--request-id ID]
         [--response full|compact]
  create --command FILE
  list [--limit N] [--cursor CURSOR] [--project NAME]
  projects
  read ID [--revision REV] [--response full|compact] [--out FILE [--quiet]]
  update ID --snapshot FILE --expected-revision REV [--request-id ID]
         [--response full|compact]
  update [ID] --command FILE
  edit ID --changes FILE [--request-id ID]
  history ID [--limit N] [--before-sequence N] [--summary]
  publish ID --revision REV --expected-version N [--request-id ID]
  publish [ID] --command FILE
  export ID --revision REV --out FILE
  move ID --project NAME [--request-id ID]
  move ID --no-project [--request-id ID]
  retry REQUEST_ID

Mutation command files contain the complete create, update, or publish JSON.
Mutation request IDs default to a random UUID. Commands are retained before
submission. Retry sends the exact retained command for the same server and owner.
Projects group artifacts by name without regard to letter case. A project
exists while it contains an artifact. Move changes the project of an artifact
without creating a revision; --no-project removes it from its project.
Read --out saves the returned artifact JSON. Export --out saves the ZIP.
Read --quiet requires --out and suppresses successful JSON stdout.
Output files are created exclusively and never overwrite an existing path.
JSON results go to stdout. Diagnostics and recovery guidance go to stderr.
ARTIFACTS_ACCESS_TOKEN supplies a token for automation without local login.
Skills commands work offline without a server, login, or private state.
They print plain text. Global server and state options are accepted and ignored.
Skills install defaults to artifacts-cli under .agents/skills in the current
directory. --agent claude uses .claude/skills. --global uses your home directory.
The installed discovery file loads instructions through artifacts skills get.
Identical files stay unchanged. Differing files require --force.
`;

class UsageError extends Error {}

const commandOptions: Record<string, readonly string[]> = {
  login: ['no-browser'], logout: [], whoami: [],
  create: ['snapshot', 'project', 'request-id', 'response', 'command'],
  list: ['limit', 'cursor', 'project'], projects: [], read: ['revision', 'response', 'out', 'quiet'],
  update: ['snapshot', 'expected-revision', 'request-id', 'response', 'command'],
  edit: ['changes', 'request-id'], history: ['limit', 'before-sequence', 'summary'],
  publish: ['revision', 'expected-version', 'request-id', 'command'],
  export: ['revision', 'out'], move: ['project', 'no-project', 'request-id'], retry: [],
  skills: ['full', 'all', 'agent', 'global', 'force'],
};

async function jsonFile(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new UsageError('JSON input must be a regular file no larger than 8 MiB');
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } finally {
    await file.close();
  }
}

async function writeOutput(path: string, bytes: string | Uint8Array): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function main(): Promise<unknown> {
  const { values, positionals, tokens } = parseArgs({
    allowPositionals: true, tokens: true,
    options: {
      server: { type: 'string' }, 'state-dir': { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' },
      'no-browser': { type: 'boolean' }, command: { type: 'string' }, snapshot: { type: 'string' },
      changes: { type: 'string' }, 'request-id': { type: 'string' }, response: { type: 'string' },
      revision: { type: 'string' }, 'expected-revision': { type: 'string' }, 'expected-version': { type: 'string' },
      limit: { type: 'string' }, cursor: { type: 'string' }, 'before-sequence': { type: 'string' },
      summary: { type: 'boolean' }, out: { type: 'string' }, quiet: { type: 'boolean' },
      full: { type: 'boolean' }, all: { type: 'boolean' }, agent: { type: 'string' },
      global: { type: 'boolean' }, force: { type: 'boolean' },
      project: { type: 'string' }, 'no-project': { type: 'boolean' },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new UsageError(`Option --${token.name} cannot be repeated`);
    seen.add(token.name);
  }
  if (values.version) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`${manifest.version}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const [command, ...arguments_] = positionals;
  if (!command || !Object.hasOwn(commandOptions, command)) throw new UsageError('Specify a command. Use artifacts --help for the reference.');
  for (const option of seen) if (!['server', 'state-dir', 'help', ...commandOptions[command]].includes(option)) throw new UsageError(`Option --${option} is not supported by ${command}`);
  if (command === 'skills') return runSkillsCommand(arguments_, values, seen);
  const resourceValue = values.server ?? process.env.ARTIFACTS_SERVER;
  if (!resourceValue) throw new UsageError('Specify --server RESOURCE or ARTIFACTS_SERVER. No production server is selected by default.');
  const resource = canonicalResource(resourceValue);
  const stateDir = resolve(values['state-dir'] ?? process.env.ARTIFACTS_STATE_DIR ?? join(homedir(), '.local', 'state', 'artifacts'));
  function argument(required = true): string | undefined {
    if (arguments_.length > 1 || (required && arguments_.length !== 1)) throw new UsageError(`${command} requires ${required ? 'one' : 'zero or one'} positional argument`);
    return arguments_[0];
  }
  function none(): void {
    if (arguments_.length) throw new UsageError(`${command} does not accept positional arguments`);
  }
  function required(name: keyof typeof values): string {
    const value = values[name];
    if (typeof value !== 'string' || !value) throw new UsageError(`Specify --${name}`);
    return value;
  }
  function integer(name: keyof typeof values): number | undefined {
    const value = values[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError(`--${name} requires a nonnegative safe integer`);
    return Number(value);
  }
  const response = values.response;
  if (response !== undefined && response !== 'full' && response !== 'compact') throw new UsageError('--response requires full or compact');
  const quiet = values.quiet ?? false;
  if (quiet) required('out');
  let commandToken: Promise<string> | undefined;
  const client = createArtifactHttpClient({ resource, accessToken: () => commandToken ??= accessToken({ resource, stateDir }) });
  async function mutate(mutation: Mutation): Promise<unknown> {
    const owner = await client.identity();
    const operation = await retainOperation(stateDir, resource, owner.userId, mutation);
    process.stderr.write(`Retained operation ${operation.command.requestId}. Recover with artifacts retry ${operation.command.requestId} using the same server and state directory.\n`);
    return submitOperation(client, operation);
  }
  async function commandFile(kind: 'create' | 'update' | 'publish'): Promise<Mutation> {
    const extra = [...seen].filter((option) => !['server', 'state-dir', 'command'].includes(option));
    if (extra.length) throw new UsageError('--command cannot be combined with mutation options');
    const value = await jsonFile(required('command'));
    if (kind === 'create') {
      none();
      return { kind, command: createSchema.parse(value) };
    }
    const mutation: Mutation = kind === 'update' ? { kind, command: updateSchema.parse(value) } : { kind, command: publishSchema.parse(value) };
    const id = argument(false);
    if (id !== undefined && id !== mutation.command.artifactId) throw new UsageError('The positional artifact ID must match the command file');
    return mutation;
  }
  switch (command) {
    case 'login':
      none();
      return login({ resource, stateDir, noBrowser: values['no-browser'] ?? false, onAuthorizationUrl: (url: string) => { process.stderr.write(`Authorize this login in your browser:\n${url}\n`); } });
    case 'logout': none(); return logout({ resource, stateDir });
    case 'whoami': none(); return client.identity();
    case 'create': {
      if (values.command) return mutate(await commandFile('create'));
      none();
      return mutate({ kind: 'create', command: createSchema.parse({ requestId: values['request-id'] ?? randomUUID(), snapshot: await jsonFile(required('snapshot')), ...(values.project === undefined ? {} : { project: values.project }), ...(response === undefined ? {} : { response }) }) });
    }
    case 'list': none(); return client.list({ ...(values.limit === undefined ? {} : { limit: integer('limit') }), ...(values.cursor === undefined ? {} : { cursor: values.cursor }), ...(values.project === undefined ? {} : { project: values.project }) });
    case 'projects': none(); return client.projects();
    case 'read': {
      const result = await client.read({ artifactId: argument()!, ...(values.revision === undefined ? {} : { revisionId: values.revision }), ...(response === undefined ? {} : { response }) });
      if (values.out) await writeOutput(values.out, `${JSON.stringify(result, null, 2)}\n`);
      return quiet ? undefined : result;
    }
    case 'update': {
      if (values.command) return mutate(await commandFile('update'));
      return mutate({ kind: 'update', command: updateSchema.parse({ artifactId: argument()!, requestId: values['request-id'] ?? randomUUID(), expectedRevisionId: required('expected-revision'), snapshot: await jsonFile(required('snapshot')), ...(response === undefined ? {} : { response }) }) });
    }
    case 'edit': {
      const artifactId = argument()!;
      const changes = await jsonFile(required('changes'));
      const input = await prepareArtifactEdit(client, { artifactId, requestId: values['request-id'] ?? randomUUID(), changes: changes as Parameters<typeof prepareArtifactEdit>[1]['changes'] });
      return mutate({ kind: 'update', command: updateSchema.parse(input) });
    }
    case 'history': return client.history({ artifactId: argument()!, ...(values.limit === undefined ? {} : { limit: integer('limit') }), ...(values['before-sequence'] === undefined ? {} : { beforeSequence: integer('before-sequence') }), ...(values.summary ? { response: 'summary' as const } : {}) });
    case 'publish': {
      if (values.command) return mutate(await commandFile('publish'));
      required('expected-version');
      return mutate({ kind: 'publish', command: publishSchema.parse({ artifactId: argument()!, requestId: values['request-id'] ?? randomUUID(), revisionId: required('revision'), expectedPublicationVersion: integer('expected-version') }) });
    }
    case 'export': {
      const output = required('out');
      const archive = await client.export({ artifactId: argument()!, revisionId: required('revision') });
      await writeOutput(output, archive.bytes);
      return { filename: archive.filename, path: resolve(output), mediaType: archive.mediaType, sha256: archive.sha256, bytes: archive.bytes.byteLength };
    }
    case 'move': {
      const artifactId = argument()!;
      if ((values.project !== undefined) === (values['no-project'] ?? false)) throw new UsageError('Specify exactly one of --project NAME or --no-project');
      return mutate({ kind: 'move', command: moveSchema.parse({ artifactId, requestId: values['request-id'] ?? randomUUID(), project: values.project ?? null }) });
    }
    case 'retry': {
      const requestId = argument()!;
      const owner = await client.identity();
      const operation = await loadOperation(stateDir, requestId, resource, owner.userId);
      process.stderr.write(`Replaying retained ${operation.kind} operation ${requestId}. The result is its retained receipt and may differ from current state.\n`);
      return submitOperation(client, operation);
    }
  }
}

try {
  const result = await main();
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const body = error instanceof HttpError
    ? { code: error.code, message: error.message, status: error.status, details: error.details }
    : error instanceof z.ZodError
      ? { code: 'invalid_input', message: 'Input does not match the artifact command schema', details: { issues: error.issues } }
      : { code: error instanceof UsageError || error instanceof TypeError || error instanceof SyntaxError ? 'invalid_arguments' : 'local_error', message: error instanceof Error ? error.message : 'Command failed', details: {} };
  process.stderr.write(`${JSON.stringify({ error: body })}\n`);
  process.exitCode = 1;
}
