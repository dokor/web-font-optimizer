import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeHtml, decodeGoogleFontsUrl, htmlAnalyzer, scan } from '@alelouet/web-font-optimizer';

const analyze = text => analyzeHtml({ file: 'index.html', language: 'html', text });
const declarations = observations => observations.filter(observation => observation.kind === 'declaration');

test('Vite index.html: preconnects, font preload, local CSS, CSS2 variants and &amp;', async () => {
  const text = await readFile(new URL('./fixtures/html/vite/index.html', import.meta.url), 'utf8');
  const observations = analyze(text);
  const resources = observations.filter(observation => observation.kind === 'resource');
  assert.deepEqual(resources.map(({ role, source }) => [role, source.kind]), [
    ['preconnect', 'url'], ['preconnect', 'url'], ['preload', 'file'], ['stylesheet', 'url'], ['stylesheet', 'file'],
  ]);
  assert.ok(resources.every(resource => resource.family === undefined));
  assert.equal(resources[3].source.value, 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,700&amp;family=Roboto+Slab:wght@100..900&amp;display=swap');
  assert.deepEqual(resources[3].location, { file: 'index.html', line: 10, column: 34 });
  const fonts = declarations(observations);
  assert.deepEqual(fonts.map(font => font.family), ['Inter', 'Roboto Slab']);
  assert.deepEqual(fonts[0].variants, [
    { style: 'normal', weight: '400' }, { style: 'normal', weight: '700' }, { style: 'italic', weight: '700' },
  ]);
  assert.deepEqual(fonts[1].variants, [{ weight: '100 900', style: 'normal' }]);
  assert.ok(fonts.every(font => font.display === 'swap'));
  assert.ok(fonts.every(font => font.sources[0].value === resources[3].source.value));
  assert.ok(observations.every(observation => observation.kind !== 'usage' && observation.kind !== 'indeterminate'));
});

test('HTML entities and the same logical URL extracted from CSS produce identical families and variants', () => {
  for (const url of [
    'https://fonts.googleapis.com/css?family=Open+Sans:400,700italic|Lora:bold&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700&family=Roboto+Slab:wght@100..900',
  ]) {
    const htmlUrl = url.replaceAll('&', '&amp;');
    const htmlFonts = declarations(analyze(`<link rel="stylesheet" href="${htmlUrl}">`));
    const css = `@import url("${url}");`;
    // Emulate the future CSS integration by passing the URL extracted from CSS.
    const cssUrl = /url\("(.*)"\)/.exec(css)[1];
    const decoded = decodeGoogleFontsUrl(cssUrl, { file: 'style.css', line: 1, column: 14 });
    assert.deepEqual(htmlFonts.map(({ family, variants }) => ({ family, variants })), decoded.families);
    assert.equal(decoded.url, url);
    assert.equal(htmlFonts[0].sources[0].value, htmlUrl);
  }
});

test('actual HTML parsing handles case, rel tokens, unquoted attributes, numeric entities and UTF-16 locations', () => {
  const text = '\r\n😀<LINK HREF =\r\n "//fonts.googleapis.com/css?family=Open&#43;Sans&#38;display=swap" REL="alternate\tSTYLESHEET">' +
    '\r<LiNk as=FONT href=/font.woff2 rel=preload>\n<link href=style.css rel=stylesheet>';
  const observations = analyze(text);
  assert.deepEqual(observations[0].location, { file: 'index.html', line: 3, column: 3 });
  assert.equal(declarations(observations)[0].family, 'Open Sans');
  assert.equal(declarations(observations)[0].display, 'swap');
  assert.deepEqual(observations.filter(o => o.kind === 'resource').map(o => o.source.value), [
    '//fonts.googleapis.com/css?family=Open&#43;Sans&#38;display=swap', '/font.woff2', 'style.css',
  ]);
  const sameLine = analyze('😀<link rel=stylesheet href="local.css">');
  assert.equal(sameLine[0].location.column, 30);
});

test('comments, scripts, styles, inert templates and irrelevant links do not declare loads', () => {
  const link = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ghost">';
  assert.deepEqual(analyze(`<!doctype html><html><head>
    <!-- ${link} -->
    <script>const text = '${link}';</script>
    <style>/* ${link} */</style>
    <template>${link}</template>
    <noscript>${link}</noscript>
    <link rel="icon" href="/favicon.ico">
    <link rel="preload" as="script" href="/main.js">
    <link rel="stylesheet"><link rel="stylesheet" href="">
    <link data-note='${link}' rel="icon" href="/other.ico">
  </head></html>`), []);
});

test('partial Google Fonts decoding keeps the original resource and emits positioned uncertainty', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;broken&amp;family=Lora:opsz,wght@14,700';
  const observations = analyze(`<link rel=stylesheet href='${url}'>`);
  assert.equal(observations[0].source.value, url);
  assert.deepEqual(declarations(observations).map(o => o.family), ['Inter', 'Lora']);
  const uncertain = observations.filter(o => o.kind === 'indeterminate');
  assert.deepEqual(uncertain.map(o => o.expression), ['broken', 'opsz']);
  assert.ok(uncertain.every(o => o.reason && o.location.line === 1 && o.location.column === 28));
  assert.deepEqual(analyze('<link rel=stylesheet href="https://fonts.googleapis.com/css2">').map(o => o.kind),
    ['resource', 'indeterminate']);
});

test('standalone preconnects and preloads prove no family or usage and a scan performs no network I/O or writes', async t => {
  for (const client of [http, https]) {
    for (const method of ['get', 'request']) t.mock.method(client, method, () => assert.fail('network I/O during scan'));
  }
  t.mock.method(globalThis, 'fetch', () => assert.fail('fetch during scan'));
  const root = await mkdtemp(join(tmpdir(), 'font-html-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'index.html');
  const text = '<link rel=preconnect href="https://fonts.googleapis.com/css2?family=NotDeclared">' +
    '<link rel=preload as=font href="https://fonts.gstatic.com/example.woff2">';
  await writeFile(file, text);
  const before = await stat(file);
  const result = await scan(root, [htmlAnalyzer]);
  assert.deepEqual(result.observations.map(o => [o.kind, o.role]), [['resource', 'preconnect'], ['resource', 'preload']]);
  assert.ok(result.observations.every(o => o.family === undefined && o.variants === undefined));
  assert.equal(await readFile(file, 'utf8'), text);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.deepEqual((await scan(root)).observations, []);
  assert.equal(declarations(analyze('<link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Inter">')).length, 1);
});
