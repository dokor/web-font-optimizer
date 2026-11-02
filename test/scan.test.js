import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { discoverSources, scan } from 'web-font-optimizer';

async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'font-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(entries)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return root;
}

test('discovers the seven languages and prunes excluded directories at any depth', async t => {
  const expected = [
    ['index.html', 'html'], ['src/app.js', 'js'], ['src/app.jsx', 'jsx'],
    ['src/app.ts', 'ts'], ['src/app.tsx', 'tsx'], ['src/styles/base.scss', 'scss'],
    ['src/styles/card.module.css', 'css'],
  ].map(([file, language]) => ({ file, language }));
  const paths = [
    ...expected.map(f => f.file), 'asset.woff2', 'src/styles/theme.css.map',
    'node_modules/a/index.js', 'src/.next/app.js', 'src/nested/dist/site.css',
    'build/generated.tsx', '.git/refs/ignore.html',
  ];
  const root = await fixture(t, Object.fromEntries(paths.map(path => [path, ''])));
  assert.deepEqual((await discoverSources(root)).files, expected);
  assert.deepEqual((await discoverSources(join(root, 'src/styles/card.module.css'))).files,
    [{ file: 'card.module.css', language: 'css' }]);
});

// Include names, contents and modification times to catch creations and rewrites.
async function snapshot(root) {
  const paths = (await readdir(root, { recursive: true })).sort();
  return Promise.all(paths.map(async path => {
    const file = join(root, path);
    const info = await stat(file);
    return [path, info.mtimeMs, info.isFile() ? await readFile(file) : null];
  }));
}

test('routes source text to matching analyzers and preserves locations without writes', async t => {
  const css = '.title {\n  font-family: Atlas;\n}';
  const root = await fixture(t, { 'src/title.css': css, 'logo.svg': '<svg/>' });
  const before = await snapshot(root);
  const location = { file: 'src/title.css', line: 2, column: 3 };
  const usage = { kind: 'usage', origin: 'font-family', family: 'Atlas', location };
  const variable = { kind: 'variable', origin: 'var()', action: 'reference', name: '--atlas', location };
  const result = await scan(root, [
    { id: 'unused', languages: ['jsx'], analyze: () => assert.fail('wrong language') },
    { id: 'synthetic-css', languages: ['css'], async analyze(source) {
      assert.deepEqual(source, { file: location.file, language: 'css', text: css });
      return [usage];
    } },
    { id: 'second-css', languages: ['css'], analyze: () => [variable] },
  ]);
  assert.deepEqual(result.observations, [usage, variable]);
  assert.deepEqual(await snapshot(root), before);
});
