import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('scan defaults to the current directory and can target one file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-cli-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, 'index.html'), '');
  await writeFile(join(root, 'main.css'), '');
  for (const [args, count] of [[['scan'], 2], [['scan', 'main.css'], 1]]) {
    const result = run(args, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `Fichiers sources découverts : ${count}`);
  }
  const missing = run(['scan', 'missing.css'], root);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing\.css/);
  assert.equal(missing.stdout, '');
});

test('help succeeds; invalid invocations explain usage on stderr', () => {
  for (const args of [['--help'], ['scan', '-h']]) {
    const result = run(args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /scan \[chemin\]/);
  }
  for (const args of [[], ['other'], ['scan', '--unknown'], ['scan', 'a', 'b']]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Arguments invalides.*Usage/);
    assert.equal(result.stdout, '');
  }
});
