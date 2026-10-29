import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const helper = resolve('skills/artifacts-design/scripts/verify-local.mjs');

test('local helper rejects malformed expectations and preserves input bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-html-config-'));
  try {
    const html = join(directory, 'page.html');
    const checks = join(directory, 'checks.json');
    const source = '<h1>Input remains unchanged</h1>';
    await writeFile(html, source);
    const invalid = [
      { expectations: [{ kind: 'visibleCount', selector: '.map', count: -1 }] },
      { expectations: [{ kind: 'visible', selector: '.map', visible: true, when: { width: 600 } }] },
      { expectations: [{ kind: 'click', selector: '#button', typo: true }] },
      { expectations: [{ kind: 'unknown', selector: '#button' }] },
      { expectations: [], timeoutMs: 0 },
    ];
    for (const value of invalid) {
      await writeFile(checks, JSON.stringify(value));
      const run = spawnSync(process.execPath, [helper, html, '--evidence', join(directory, 'evidence'), '--expectations', checks], { encoding: 'utf8' });
      assert.equal(run.status, 2, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.status, 'blocked');
      assert.ok(report.errors.length);
      assert.equal(JSON.parse(await readFile(join(report.evidenceDirectory, 'report.json'), 'utf8')).status, 'blocked');
    }
    const collision = spawnSync(process.execPath, [helper, html, '--evidence', html], { encoding: 'utf8' });
    assert.equal(collision.status, 2);
    assert.match(JSON.parse(collision.stdout).errors.join(' '), /overwrite/);
    assert.equal(await readFile(html, 'utf8'), source);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local helper diagnoses missing runtime and incompatible browser without installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-html-setup-'));
  try {
    const html = join(directory, 'page.html');
    const isolated = join(directory, 'verify-local.mjs');
    await writeFile(html, '<h1>Setup diagnostic</h1>');
    await copyFile(helper, isolated);
    const missingRuntime = spawnSync(process.execPath, [isolated, html, '--evidence', join(directory, 'runtime-evidence')], { cwd: directory, encoding: 'utf8' });
    assert.equal(missingRuntime.status, 2, missingRuntime.stderr);
    assert.match(JSON.parse(missingRuntime.stdout).errors.join(' '), /existing playwright or playwright-core/);
    const missingBrowser = spawnSync(process.execPath, [helper, html, '--evidence', join(directory, 'browser-evidence'), '--browser', join(directory, 'absent')], { encoding: 'utf8' });
    assert.equal(missingBrowser.status, 2, missingBrowser.stderr);
    const report = JSON.parse(missingBrowser.stdout);
    assert.match(report.errors.join(' '), /--browser/);
    assert.equal(report.browserDiagnostics.length, 1);
    if (process.platform !== 'win32') {
      const old = join(directory, 'old-chromium');
      await writeFile(old, '#!/bin/sh\necho "Chromium 151.0.0.0"\n');
      await chmod(old, 0o755);
      const incompatible = spawnSync(process.execPath, [helper, html, '--evidence', join(directory, 'old-evidence'), '--browser', old], { encoding: 'utf8' });
      assert.equal(incompatible.status, 2, incompatible.stderr);
      assert.match(JSON.parse(incompatible.stdout).browserDiagnostics[0].reason, /152\+/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
