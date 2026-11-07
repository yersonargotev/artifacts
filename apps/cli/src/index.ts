#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createSchema, listSharesSchema, moveSchema, publishSchema, shareSchema, unshareSchema, updateSchema } from '@yargote/artifacts-contracts';
import { canonicalResource } from '@yargote/artifacts-contracts/http';
import { BatchOperationError, createArtifactHttpClient, HttpError, prepareArtifactEdit, prepareBatch } from '@yargote/artifacts-client';
import { accessToken, login, logout } from './auth.ts';
import { CredentialStore } from './credentials.ts';
import { loadOperation, retainOperation, submitOperation, type Mutation } from './operations.ts';
import { runSkillsCommand } from './skills.ts';

const help = `Usage: artifacts COMMAND [OPTIONS]

Global options:
  --server RESOURCE       Exact REST OAuth resource, or ARTIFACTS_SERVER
                         Defaults to the last successful login
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
  create --snapshot FILE [--project NAME] [--slug SLUG] [--request-id ID]
         [--response full|compact]
  create --command FILE
  list [--limit N] [--cursor CURSOR] [--project NAME]
  projects
  search QUERY [--project NAME] [--limit N] [--cursor CURSOR]
  read ID [--revision REV] [--response full|compact] [--out FILE [--quiet]]
  read --slug SLUG [--project NAME] [--revision REV] [--response full|compact]
         [--out FILE [--quiet]]
  update ID --snapshot FILE --expected-revision REV [--request-id ID]
         [--response full|compact]
  update [ID] --command FILE
  edit ID --changes FILE [--request-id ID]
  batch --command FILE
  history ID [--limit N] [--before-sequence N] [--summary]
  publish ID --revision REV --expected-version N [--request-id ID]
  publish [ID] --command FILE
  export ID --revision REV --out FILE
  move ID [--project NAME | --no-project] [--slug SLUG | --no-slug]
         [--request-id ID]
  share ID --email EMAIL [--notify] [--request-id ID]
  shares ID
  unshare ID SHARE_ID [--request-id ID]
  retry REQUEST_ID

Mutation command files contain the complete create, update, publish, or batch
JSON.
Mutation request IDs default to a random UUID. Commands are retained before
submission. Retry sends the exact retained command for the same server and owner.
Projects group artifacts by name without regard to letter case. A project
exists while it contains an artifact. Move changes the project or the slug of
an artifact without creating a revision. It needs at least one of its four
options. --no-project removes the artifact from its project, and --no-slug
clears its slug. An option left out keeps that value, so a move to another
project keeps the slug.
A slug such as concepts/rag names an artifact within its project, or within
the unfiled artifacts without --project. Read --slug finds it without its ID.
Create or move fails with slug_conflict when the project already uses the slug.
Search finds owned artifacts whose head contains every term of QUERY, ignoring
letter case and accents. It reads Markdown and text content, the visible text
of HTML, and the title and description of every kind. Quote a QUERY with
spaces. Results are ordered by relevance with a **bold** snippet.
Batch applies 1 to 25 create, update, edit, and move operations from one command
file with a requestId and operations. All succeed or none do. A failure names the
0-based index of its operation. An update addresses its artifact by artifactId or
by project and slug, including a page created earlier in the batch, and omits
expectedRevisionId only for such a page. An edit takes the same address and the
changes of edit --changes for a page that exists before the batch. The CLI reads
its head and sends an update with that expectedRevisionId, so a page changed
meanwhile, or written earlier in the batch, fails with conflict; use update for
such a page. Retry sends the prepared batch. A move addresses its artifact by
artifactId or by from { project, slug } and takes the move project and slug.
Later operations address a moved page by its new slug. A batch never publishes.
Read --out saves the returned artifact JSON. Export --out saves the ZIP.
Read --quiet requires --out and suppresses successful JSON stdout.
Output files are created exclusively and never overwrite an existing path.
JSON results go to stdout. Diagnostics and recovery guidance go to stderr.
Login accepts an MCP URL when its metadata advertises artifacts_rest_resource.
Split MCP and REST resources require this relation. Login remembers the verified
REST URL for later commands. --server takes precedence over ARTIFACTS_SERVER,
which takes precedence over the saved URL. Ordinary overrides do not replace
the saved URL. Logout keeps it for a later login.
Login checks <resource>/v1/identity before browser
authorization. Legacy /mcp
resources work when their REST API is at /mcp/v1. If the check fails, confirm
the configured REST URL with your service administrator.
Login errors report the phase, method, endpoint, and HTTP status when received.
Network failures have no HTTP status. Login verifies identity again after OAuth.
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
  create: ['snapshot', 'project', 'slug', 'request-id', 'response', 'command'],
  list: ['limit', 'cursor', 'project'], projects: [], search: ['project', 'limit', 'cursor'], read: ['slug', 'project', 'revision', 'response', 'out', 'quiet'],
  update: ['snapshot', 'expected-revision', 'request-id', 'response', 'command'],
  edit: ['changes', 'request-id'], batch: ['command'], history: ['limit', 'before-sequence', 'summary'],
  publish: ['revision', 'expected-version', 'request-id', 'command'],
  share: ['email', 'notify', 'request-id'], shares: [], unshare: ['request-id'],
  export: ['revision', 'out'], move: ['project', 'no-project', 'slug', 'no-slug', 'request-id'], retry: [],
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
      project: { type: 'string' }, 'no-project': { type: 'boolean' }, slug: { type: 'string' }, 'no-slug': { type: 'boolean' }, email: { type: 'string' }, notify: { type: 'boolean' },
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
  const stateDir = resolve(values['state-dir'] ?? process.env.ARTIFACTS_STATE_DIR ?? join(homedir(), '.local', 'state', 'artifacts'));
  let resourceValue = values.server ?? process.env.ARTIFACTS_SERVER;
  if (resourceValue === undefined) {
    const store = await CredentialStore.open(stateDir);
    try { resourceValue = await store.exclusive(() => store.readSelectedResource()); }
    finally { store.close(); }
  }
  if (resourceValue === undefined) throw new UsageError('No server is saved. Run artifacts login --server RESOURCE or set ARTIFACTS_SERVER.');
  const resource = canonicalResource(resourceValue);
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
  function cleared(name: string, value: string | undefined, clear: boolean | undefined): string | null | undefined {
    if (value !== undefined && clear) throw new UsageError(`Specify at most one of --${name} or --no-${name}`);
    return clear ? null : value;
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
  async function commandFile(kind: 'create' | 'update' | 'publish' | 'batch'): Promise<Mutation> {
    const extra = [...seen].filter((option) => !['server', 'state-dir', 'command'].includes(option));
    if (extra.length) throw new UsageError('--command cannot be combined with mutation options');
    const value = await jsonFile(required('command'));
    if (kind === 'create' || kind === 'batch') {
      none();
      return kind === 'create' ? { kind, command: createSchema.parse(value) } : { kind, command: await prepareBatch(client, value as Parameters<typeof prepareBatch>[1]) };
    }
    const mutation: Mutation = kind === 'update' ? { kind, command: updateSchema.parse(value) } : { kind, command: publishSchema.parse(value) };
    const id = argument(false);
    if (id !== undefined && id !== mutation.command.artifactId) throw new UsageError('The positional artifact ID must match the command file');
    return mutation;
  }
  switch (command) {
    case 'login':
      none();
      {
        const result = await login({ resource, stateDir, noBrowser: values['no-browser'] ?? false, onAuthorizationUrl: (url: string) => { process.stderr.write(`Authorize this login in your browser:\n${url}\n`); } });
        if (result.resource !== resource) process.stderr.write(`REST resource: ${result.resource}\nThis verified REST URL is saved for subsequent commands.\n`);
        return result.identity;
      }
    case 'logout': none(); return logout({ resource, stateDir });
    case 'whoami': none(); return client.identity();
    case 'create': {
      if (values.command) return mutate(await commandFile('create'));
      none();
      return mutate({ kind: 'create', command: createSchema.parse({ requestId: values['request-id'] ?? randomUUID(), snapshot: await jsonFile(required('snapshot')), ...(values.project === undefined ? {} : { project: values.project }), ...(values.slug === undefined ? {} : { slug: values.slug }), ...(response === undefined ? {} : { response }) }) });
    }
    case 'list': none(); return client.list({ ...(values.limit === undefined ? {} : { limit: integer('limit') }), ...(values.cursor === undefined ? {} : { cursor: values.cursor }), ...(values.project === undefined ? {} : { project: values.project }) });
    case 'projects': none(); return client.projects();
    case 'search': return client.search({ query: argument()!, ...(values.project === undefined ? {} : { project: values.project }), ...(values.limit === undefined ? {} : { limit: integer('limit') }), ...(values.cursor === undefined ? {} : { cursor: values.cursor }) });
    case 'read': {
      if (values.slug === undefined && values.project !== undefined) throw new UsageError('read --project requires --slug');
      if ((values.slug === undefined) !== (arguments_.length === 1) || arguments_.length > 1) throw new UsageError('read requires exactly one of an artifact ID or --slug SLUG');
      const target = values.slug === undefined ? { artifactId: arguments_[0]! } : { slug: values.slug, ...(values.project === undefined ? {} : { project: values.project }) };
      const result = await client.read({ ...target, ...(values.revision === undefined ? {} : { revisionId: values.revision }), ...(response === undefined ? {} : { response }) });
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
    case 'batch': return mutate(await commandFile('batch'));
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
      const project = cleared('project', values.project, values['no-project']);
      const slug = cleared('slug', values.slug, values['no-slug']);
      if (project === undefined && slug === undefined) throw new UsageError('move requires --project NAME, --no-project, --slug SLUG, or --no-slug');
      return mutate({ kind: 'move', command: moveSchema.parse({ artifactId, requestId: values['request-id'] ?? randomUUID(), ...(project === undefined ? {} : { project }), ...(slug === undefined ? {} : { slug }) }) });
    }
    case 'share': return mutate({ kind: 'share', command: shareSchema.parse({ artifactId: argument()!, requestId: values['request-id'] ?? randomUUID(), email: required('email'), ...(values.notify === undefined ? {} : { notify: values.notify }) }) });
    case 'shares': return client.listShares(listSharesSchema.parse({ artifactId: argument()! }));
    case 'unshare': {
      if (arguments_.length !== 2) throw new UsageError('unshare requires two positional arguments');
      return mutate({ kind: 'unshare', command: unshareSchema.parse({ artifactId: arguments_[0], shareId: arguments_[1], requestId: values['request-id'] ?? randomUUID() }) });
    }
    case 'retry': {
      const requestId = argument()!;
      const owner = await client.identity();
      const operation = await loadOperation(stateDir, requestId, resource, owner.userId);
      process.stderr.write(`Replaying retained ${operation.kind} operation ${requestId}. Replay confirms the original operation and does not establish current state.\n`);
      return submitOperation(client, operation);
    }
  }
}

function errorBody(error: unknown): { code: string; message: string; status?: number; details: Record<string, unknown> } {
  if (error instanceof BatchOperationError) {
    const body = errorBody(error.cause);
    return { ...body, details: { ...body.details, index: error.index } };
  }
  return error instanceof HttpError
    ? { code: error.code, message: error.message, status: error.status, details: error.details }
    : error instanceof z.ZodError
      ? { code: 'invalid_input', message: 'Input does not match the artifact command schema', details: { issues: error.issues } }
      : { code: error instanceof UsageError || error instanceof TypeError || error instanceof SyntaxError ? 'invalid_arguments' : 'local_error', message: error instanceof Error ? error.message : 'Command failed', details: {} };
}

try {
  const result = await main();
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: errorBody(error) })}\n`);
  process.exitCode = 1;
}
