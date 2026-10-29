import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function prepareRetainedSelection({ receipt, expected, checks, panelOrigin, evidenceDirectory, publicationReceipt }) {
  requireValue(object(receipt) && object(receipt.revision), 'Write receipt must identify a saved revision');
  requireValue(
    typeof receipt.artifactId === 'string' && receipt.artifactId.length > 0 &&
    typeof receipt.revision.id === 'string' && receipt.revision.id.length > 0 &&
    /^[a-f0-9]{64}$/.test(receipt.revision.sha256),
    'Write receipt must contain artifact, revision, and SHA-256',
  );
  const snapshot = expected?.revision?.snapshot;
  requireValue(
    object(expected) && object(snapshot) && object(snapshot.metadata) &&
    typeof snapshot.metadata.title === 'string' && typeof snapshot.metadata.description === 'string' &&
    object(snapshot.content) && ['html', 'markdown', 'text'].includes(snapshot.content.kind) &&
    typeof snapshot.content.text === 'string' && Array.isArray(snapshot.files),
    'Independent read must contain the full snapshot, not a compact response',
  );
  requireValue(expected.artifactId === receipt.artifactId && expected.revision.id === receipt.revision.id && expected.revision.sha256 === receipt.revision.sha256, 'Independent read differs from the saved write receipt');
  requireValue(typeof expected.headRevisionId === 'string' && expected.headRevisionId.length > 0, 'Independent read must identify its current draft head');
  requireValue(object(checks) && Object.keys(checks).every((key) => ['viewports', 'expectations', 'timeoutMs'].includes(key)) && Array.isArray(checks.viewports) && checks.viewports.length > 0 && Array.isArray(checks.expectations), 'Checks must contain viewports and expectations, with optional timeoutMs');
  let panel;
  try { panel = new URL(panelOrigin); } catch { throw new Error('Panel origin must be an observed HTTP origin'); }
  requireValue(['http:', 'https:'].includes(panel.protocol) && !panel.username && !panel.password && panel.pathname === '/' && !panel.search && !panel.hash, 'Panel origin must be an observed HTTP origin without a path, credentials, query, or fragment');
  panel.pathname = `/artifacts/${encodeURIComponent(expected.artifactId)}`;
  panel.searchParams.set('revisionId', expected.revision.id);
  let publicationUrl;
  if (publicationReceipt !== undefined) {
    const current = expected.publication;
    requireValue(
      object(publicationReceipt) && object(current) &&
      publicationReceipt.artifactId === expected.artifactId &&
      publicationReceipt.revisionId === expected.revision.id && publicationReceipt.revisionId === current.revisionId &&
      Number.isInteger(publicationReceipt.version) && publicationReceipt.version > 0 && publicationReceipt.version === current.version &&
      typeof publicationReceipt.url === 'string' && publicationReceipt.url === current.url,
      'Publication differs from the requested receipt or selected revision; report the changed or different publication',
    );
    let publication;
    try { publication = new URL(current.url); } catch { throw new Error('Publication receipt must contain a stable HTTP URL'); }
    requireValue(['http:', 'https:'].includes(publication.protocol) && !publication.username && !publication.password && !publication.search && !publication.hash && publication.pathname === `/a/${encodeURIComponent(expected.artifactId)}`, 'Publication receipt must contain the selected artifact stable HTTP URL');
    publicationUrl = publication.href;
  }
  return {
    expected,
    panelUrl: panel.href,
    ...(publicationUrl === undefined ? {} : { publicationUrl }),
    ...checks,
    evidenceDirectory: resolve(evidenceDirectory),
  };
}

const required = ['--receipt', '--read', '--panel-origin', '--checks', '--evidence', '--out'];
try {
  const args = process.argv.slice(2);
  const options = new Map();
  requireValue(args.length % 2 === 0, 'Use named options with one value each');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    requireValue([...required, '--publication-receipt'].includes(name) && !options.has(name) && typeof args[index + 1] === 'string' && args[index + 1].length > 0, 'Use each supported option once with a nonempty value');
    options.set(name, args[index + 1]);
  }
  requireValue(required.every((name) => options.has(name)), 'Required options are --receipt --read --panel-origin --checks --evidence --out');
  const json = async (name) => {
    try { return JSON.parse(await readFile(options.get(name), 'utf8')); }
    catch { throw new Error(`Cannot read valid JSON for ${name}`); }
  };
  const receipt = await json('--receipt');
  const expected = await json('--read');
  const checks = await json('--checks');
  const publication = options.has('--publication-receipt') ? await json('--publication-receipt') : undefined;
  const config = prepareRetainedSelection({ receipt, expected, checks, panelOrigin: options.get('--panel-origin'), evidenceDirectory: options.get('--evidence'), publicationReceipt: publication });
  try { await writeFile(options.get('--out'), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { throw new Error(error?.code === 'EEXIST' ? 'Config output already exists; choose a new output path' : 'Cannot create the private config output'); }
  const headChanged = expected.headRevisionId !== expected.revision.id;
  console.log(JSON.stringify({ status: 'prepared', headChanged, publication: publication === undefined ? 'not-requested' : 'requested' }));
  if (headChanged) console.error('Current draft head differs from the selected saved revision. The selection remains pinned.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
