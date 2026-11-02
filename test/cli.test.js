import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exampleReport } from 'web-font-optimizer/examples/report-v1';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('scan defaults to the current directory and can target one file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-cli-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, 'index.html'), '');
  await writeFile(join(root, 'main.css'), '');
  for (const args of [['scan'], ['scan', 'main.css']]) {
    const result = run(args, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audit des polices — rapport v1/);
    assert.match(result.stdout, /Inventaire : 0 observation\(s\), 0 ressource\(s\)/);
    assert.match(result.stdout, /Aucun diagnostic/);
  }
  for (const format of ['terminal', 'json']) {
    const missing = run(['scan', 'missing.css', '--report', format, '--fail-on-duplicates'], root);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /missing\.css/);
    assert.equal(missing.stdout, '');
  }

  const json = run(['scan', '--report', 'json', '--fail-on-duplicates'], root);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    version: 1, inventory: { observations: [], resources: [] }, diagnostics: [],
  });
  assert.equal(json.stderr, '');
});

test('process exit statuses match policy and JSON stays parseable on status 1', async t => {
  // This small harness supplies an audit result at the public injection point.
  // Production analyzer/engine registration belongs to #8.
  const runner = `
    import { readFile } from 'node:fs/promises';
    import { runCli } from ${JSON.stringify(new URL('../dist/reporters/index.js', import.meta.url).href)};
    const report = JSON.parse(await readFile(process.argv[1], 'utf8'));
    process.exitCode = await runCli(process.argv.slice(2), {
      audit: () => report,
      stdout: text => process.stdout.write(text),
      stderr: text => process.stderr.write(text),
    });
  `;
  const root = await mkdtemp(join(tmpdir(), 'font-report-cli-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const warningFile = join(root, 'warning.json');
  await writeFile(warningFile, JSON.stringify(exampleReport));
  const duplicateFile = fileURLToPath(new URL('./fixtures/duplicate-report.json', import.meta.url));
  for (const [fixture, ci, expectedCode] of [
    [warningFile, false, 0], [warningFile, true, 0],
    [duplicateFile, false, 0], [duplicateFile, true, 1],
  ]) {
    for (const format of ['terminal', 'json']) {
      const args = ['--input-type=module', '-e', runner, fixture, 'scan', '--report', format];
      if (ci) args.push('--fail-on-duplicates');
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1' } });
      assert.equal(result.status, expectedCode, result.stderr);
      assert.equal(result.stderr, '');
      if (format === 'json') {
        const report = JSON.parse(result.stdout);
        assert.equal(report.version, 1);
        assert.equal(report.diagnostics[0].confidence, fixture === warningFile ? 'possible' : 'certain');
        assert.doesNotMatch(result.stdout, /\x1b/);
      } else assert.match(result.stdout, /Action :/);
    }
  }
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
