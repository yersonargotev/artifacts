import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface BundledSkill {
  name: string;
  description: string;
  directory: string;
  skillText: Buffer;
}

interface SkillsOptions {
  full?: boolean;
  all?: boolean;
  agent?: string;
  global?: boolean;
  force?: boolean;
}

type SkillsCommand =
  | { kind: 'list' }
  | { kind: 'get'; selection: { name: string } | { all: true }; full: boolean }
  | { kind: 'path'; name?: string }
  | { kind: 'install'; name: string; agent: 'agents' | 'claude'; global: boolean; force: boolean };

const catalogDirectory = resolve(fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../../../skills/' : '../skills/', import.meta.url)));

function parseCommand(positionals: string[], options: SkillsOptions, seen: ReadonlySet<string>): SkillsCommand {
  const [kind = 'list', ...arguments_] = positionals;
  const allowed: Record<string, string[]> = { list: [], get: ['all', 'full'], path: [], install: ['agent', 'global', 'force'] };
  if (!Object.hasOwn(allowed, kind)) throw new TypeError(`Unknown skills command ${kind}. Use artifacts --help for the reference.`);
  for (const option of seen) {
    if (!['server', 'state-dir', ...allowed[kind]].includes(option)) throw new TypeError(`Option --${option} is not supported by skills ${kind}`);
  }
  switch (kind) {
    case 'list':
      if (arguments_.length) throw new TypeError('skills list does not accept positional arguments');
      return { kind };
    case 'get':
      if (arguments_.length > 1 || (options.all ? arguments_.length !== 0 : arguments_.length !== 1)) throw new TypeError('skills get requires either one skill name or --all');
      return { kind, selection: options.all ? { all: true } : { name: arguments_[0] }, full: options.full ?? false };
    case 'path':
      if (arguments_.length > 1) throw new TypeError('skills path accepts zero or one skill name');
      return { kind, name: arguments_[0] };
    case 'install':
      if (arguments_.length > 1) throw new TypeError('skills install accepts zero or one skill name');
      if (options.agent !== undefined && options.agent !== 'claude') throw new TypeError('--agent requires claude. Omit --agent to install under .agents.');
      return { kind, name: arguments_[0] ?? 'artifacts-cli', agent: options.agent === 'claude' ? 'claude' : 'agents', global: options.global ?? false, force: options.force ?? false };
    default:
      throw new TypeError(`Unknown skills command ${kind}`);
  }
}

async function loadCatalog(): Promise<BundledSkill[]> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { artifactsSkills?: unknown };
  const names = manifest.artifactsSkills;
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) || new Set(names).size !== names.length) throw new Error('Invalid bundled skills declaration');
  return Promise.all((names as string[]).toSorted().map(async (name) => {
    const directory = join(catalogDirectory, name);
    const skillText = await readFile(join(directory, 'SKILL.md'));
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillText.toString('utf8'))?.[1];
    const declaredName = frontmatter && /^name: (.+)$/m.exec(frontmatter)?.[1];
    const description = frontmatter && /^description: (.+)$/m.exec(frontmatter)?.[1];
    if (declaredName !== name || !description) throw new Error(`Invalid bundled skill frontmatter at ${join(directory, 'SKILL.md')}`);
    return { name, description, directory, skillText };
  }));
}

async function fullFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await fullFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Bundled skill contains a non-regular file at ${join(directory, entry.name)}`);
  }
  return files;
}

function isText(content: Buffer): boolean {
  if (content.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(content); return true; }
  catch { return false; }
}

async function labeledContent(skills: BundledSkill[], full: boolean): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (const skill of skills) {
    const files = full ? ['SKILL.md', ...(await fullFiles(skill.directory)).filter((path) => path !== 'SKILL.md')] : ['SKILL.md'];
    for (const path of files) {
      const content = path === 'SKILL.md' ? skill.skillText : await readFile(join(skill.directory, path));
      if (!isText(content)) {
        chunks.push(Buffer.from(`=== ${skill.name}/${path} (binary, ${content.length} bytes) ===\n`));
        continue;
      }
      chunks.push(Buffer.from(`=== ${skill.name}/${path} ===\n`), content);
      if (content.at(-1) !== 10) chunks.push(Buffer.from('\n'));
    }
  }
  return Buffer.concat(chunks);
}

function discoveryText(skill: BundledSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\nBefore using this skill, run \`artifacts skills get ${skill.name} --full\`.\nLoad and follow the complete instructions, references, and templates bundled with the installed CLI version.\nRelative paths refer to the bundled directory reported by \`artifacts skills path ${skill.name}\`.\n`;
}

async function installSkill(skill: BundledSkill, command: Extract<SkillsCommand, { kind: 'install' }>): Promise<string> {
  const destination = resolve(command.global ? homedir() : process.cwd(), command.agent === 'claude' ? '.claude' : '.agents', 'skills', skill.name, 'SKILL.md');
  const content = Buffer.from(discoveryText(skill));
  await mkdir(dirname(destination), { recursive: true });
  try {
    const file = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await file.writeFile(content); }
    finally { await file.close(); }
    return destination;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const existing = await lstat(destination);
  if (!existing.isFile()) throw new TypeError(`Cannot install ${destination}. The destination must be a regular file, not a directory or symbolic link.`);
  const file = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
  let previous: Buffer;
  try {
    if (!(await file.stat()).isFile()) throw new TypeError(`Cannot install ${destination}. The destination must be a regular file.`);
    previous = await file.readFile();
  } finally { await file.close(); }
  if (previous.equals(content)) return destination;
  if (!command.force) throw new TypeError(`Cannot replace differing file ${destination}. Use --force to replace it.`);
  const temporary = join(dirname(destination), `.SKILL.md.${randomUUID()}.tmp`);
  try {
    const replacement = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await replacement.writeFile(content); }
    finally { await replacement.close(); }
    const current = await lstat(destination);
    if (!current.isFile()) throw new TypeError(`Cannot install ${destination}. The destination must be a regular file, not a directory or symbolic link.`);
    if (current.ino !== existing.ino || current.dev !== existing.dev || current.mtimeMs !== existing.mtimeMs || current.ctimeMs !== existing.ctimeMs) throw new TypeError(`Cannot replace ${destination}. The destination changed during installation. Run the command again.`);
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return destination;
}

export async function runSkillsCommand(positionals: string[], options: SkillsOptions, seen: ReadonlySet<string>): Promise<void> {
  const command = parseCommand(positionals, options, seen);
  const skills = await loadCatalog();
  function named(name: string): BundledSkill {
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) throw new TypeError(`Unknown bundled skill ${name}. Use artifacts skills list to inspect available skills.`);
    return skill;
  }
  switch (command.kind) {
    case 'list':
      process.stdout.write(skills.map((skill) => `${skill.name}\t${skill.description}\n`).join(''));
      return;
    case 'get': {
      const selection = 'all' in command.selection ? skills : [named(command.selection.name)];
      process.stdout.write(!command.full && 'name' in command.selection ? selection[0].skillText : await labeledContent(selection, command.full));
      return;
    }
    case 'path':
      process.stdout.write(`${command.name === undefined ? catalogDirectory : named(command.name).directory}\n`);
      return;
    case 'install':
      process.stdout.write(`${await installSkill(named(command.name), command)}\n`);
  }
}
