import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check with npm run test:package.');
const temporary = await mkdtemp(join(tmpdir(), 'web-font-optimizer-package-'));

function run(executable, args, cwd, expected = 0) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const [packed] = JSON.parse(run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', temporary], root));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const included = new Set(packed.files.map(file => file.path));
  for (const entry of Object.values(manifest.exports)) {
    assert.ok(included.has(entry.import.replace(/^\.\//, '')), `Missing JS export: ${entry.import}`);
    assert.ok(included.has(entry.types.replace(/^\.\//, '')), `Missing type export: ${entry.types}`);
  }
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer);
  const check = `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { scan, htmlAnalyzer, reactAnalyzer, decodeGoogleFontsUrl, buildAuditReport } from 'web-font-optimizer';
    import { cssAnalyzer } from 'web-font-optimizer/analyzers/css';
    import { nextAnalyzer } from 'web-font-optimizer/analyzers/next';
    import { exampleReport } from 'web-font-optimizer/examples/report-v1';
    import { renderJson, renderTerminal, getExitCode, runCli } from 'web-font-optimizer/reporters';
    import 'web-font-optimizer/contracts';
    assert.equal(existsSync('node_modules/@types/node'), false);
    for (const name of ['react', 'next', 'vite']) assert.equal(existsSync('node_modules/' + name), false);
    assert.equal(typeof runCli, 'function');
    assert.deepEqual(JSON.parse(renderJson(exampleReport)), exampleReport);
    assert.match(renderTerminal(exampleReport), /rapport v1/);
    assert.equal(getExitCode(exampleReport, { failOnDuplicates: true }), 0);
    assert.equal(decodeGoogleFontsUrl('https://fonts.googleapis.com/css2?family=Inter', { file: 'index.html', line: 1, column: 1 }).families[0].family, 'Inter');
    for (const [analyzer, file, language, text] of [
      [cssAnalyzer, 'style.css', 'css', 'body { font-family: Atlas; }'],
      [htmlAnalyzer, 'index.html', 'html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'],
      [reactAnalyzer, 'App.jsx', 'jsx', 'const view = <p style={{ fontFamily: "Atlas" }} />;'],
      [nextAnalyzer, 'page.tsx', 'tsx', 'import { Inter } from "next/font/google"; const font = Inter({ weight: "400" });'],
    ]) assert.ok((await analyzer.analyze({ file, language, text })).length > 0, analyzer.id);
    const result = await scan(process.argv[1], [cssAnalyzer, htmlAnalyzer, reactAnalyzer, nextAnalyzer]);
    assert.ok(result.files.length > 0);
    assert.ok(result.observations.length > 0);
    const report = await buildAuditReport(result.observations, { root: process.argv[1] });
    assert.equal(JSON.parse(renderJson(report)).version, 1);
  `;
  run(process.execPath, ['--input-type=module', '-e', check, join(root, 'test', 'fixtures', 'react-vite')], consumer);
  assert.match(run(process.execPath, [npmCli, 'exec', '--offline', '--', 'web-font-optimizer', '--help'], consumer), /scan \[chemin\]/);
  const output = run(process.execPath, [npmCli, 'exec', '--offline', '--', 'web-font-optimizer', 'scan', join(root, 'src', 'discovery.ts'), '--report', 'json', '--fail-on-duplicates'], consumer);
  assert.equal(JSON.parse(output).version, 1);
  const cli = join(consumer, 'node_modules', 'web-font-optimizer', 'dist', 'cli.js');
  run(process.execPath, [cli, 'scan', join(temporary, 'missing.css')], consumer, 2);
  console.log('Production package: exports, analyzers, engine, reporters and CLI verified.');
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
