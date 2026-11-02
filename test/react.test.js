import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { reactAnalyzer, scan } from 'web-font-optimizer';

const analyze = (text, language = 'tsx', file = `src/Card.${language}`) => reactAnalyzer.analyze({ file, language, text });
const usage = observations => observations.filter(o => o.kind === 'usage');

test('JSX inline styles preserve family fallback order, variants, values and positions', () => {
  const text = `export const Card = () => <p style={{
  fontFamily: '"Atlas Sans", Arial, sans-serif',
  fontWeight: 700,
  fontStyle: 'italic',
  font: 'oblique 12deg 600 16px/1.4 "Atlas Sans", serif',
  color: 'red'
}}>Hello</p>;`;
  const observations = analyze(text, 'jsx');
  assert.equal(observations.length, 4);
  assert.deepEqual(observations[0], {
    kind: 'usage', origin: 'react:style:fontFamily',
    location: { file: 'src/Card.jsx', line: 2, column: 3 },
    value: '"Atlas Sans", Arial, sans-serif', family: 'Atlas Sans',
    familyStack: ['Atlas Sans', 'Arial', 'sans-serif'],
  });
  assert.deepEqual(observations[1].variants, [{ weight: '700' }]);
  assert.deepEqual(observations[2].variants, [{ style: 'italic' }]);
  assert.deepEqual(observations[3].familyStack, ['Atlas Sans', 'serif']);
  assert.deepEqual(observations[3].variants, [{ weight: '600', style: 'oblique 12deg' }]);
});

test('unknown theme.font is indeterminate at its expression, and later styles are analyzed', () => {
  const text = `const Card = () => <><p style={{ fontFamily: theme.font }} /><p style={{ fontWeight: 500 }} /></>;`;
  const observations = analyze(text, 'jsx');
  assert.equal(observations[0].kind, 'indeterminate');
  assert.equal(observations[0].expression, 'theme.font');
  assert.match(observations[0].reason, /non résolue/);
  assert.deepEqual(observations[0].location, { file: 'src/Card.jsx', line: 1, column: text.indexOf('theme.font') + 1 });
  assert.deepEqual(observations[1].variants, [{ weight: '500' }]);
});

test('CSS variables, including nested fallbacks, stay unresolved with their raw value', () => {
  const value = 'var(--heading, var(--body, "Atlas Sans")), sans-serif';
  const observations = analyze(`const Card = () => <p style={{fontFamily: '${value}', fontWeight: 'var(--weight, 600)'}} />;`);
  assert.deepEqual(observations.filter(o => o.kind === 'variable').map(o => [o.name, o.value]), [
    ['--heading', value], ['--body', value], ['--weight', 'var(--weight, 600)'],
  ]);
  assert.equal(observations.filter(o => o.kind === 'indeterminate').length, 2);
  assert.equal(usage(observations).length, 0);
  const quoted = analyze(`const Card = () => <p style={{fontFamily: '"var(--literal)"'}} />;`);
  assert.deepEqual(quoted[0].familyStack, ['var(--literal)']);
});

test('TSX CSS Module direct references link to canonical discovered stylesheet paths', () => {
  const text = `import styles from './Card.module.css';
import * as theme from './theme.module.scss';
const key = 'title';
export const Card = () => <h1 className={styles.title + ' ' + styles['wide-title'] + theme[key]}>Hello</h1>;`;
  const observations = analyze(text);
  assert.deepEqual(observations.filter(o => o.kind === 'resource').map(o => o.source), [
    { kind: 'file', value: 'src/Card.module.css' }, { kind: 'file', value: 'src/theme.module.scss' },
  ]);
  assert.deepEqual(usage(observations).map(o => o.cssModule), [
    { stylesheet: 'src/Card.module.css', className: 'title' },
    { stylesheet: 'src/Card.module.css', className: 'wide-title' },
    { stylesheet: 'src/theme.module.scss', className: 'title' },
  ]);
  assert.ok(usage(observations).every(o => o.context === 'static-code-reference' && o.family === undefined));
  assert.deepEqual(usage(observations)[0].location, { file: 'src/Card.tsx', line: 4, column: 42 });
});

test('module references in unused code are code evidence, while shadowed bindings are ignored', () => {
  const observations = analyze(`import styles from './Card.module.css';
function neverRendered() { return styles.title; }
function shadowed(styles: { title: string }) { return styles.title; }
{ const styles = { title: 'fake' }; console.log(styles.title); }
const Card = () => <p className={styles[theme.key]} />;`);
  assert.equal(usage(observations).length, 1);
  assert.equal(usage(observations)[0].context, 'static-code-reference');
  assert.equal(observations.at(-1).kind, 'indeterminate');
  assert.equal(observations.at(-1).expression, 'styles[theme.key]');
});

test('all four languages recognize local CSS / SCSS imports without resolving or opening them', () => {
  for (const language of ['js', 'jsx', 'ts', 'tsx']) {
    const observations = analyze(`import '../styles/site.css';
import sheet from './nested/../theme.scss?inline';
import 'package/theme.css';
import 'https://example.test/theme.css';
import logo from './logo.svg';`, language);
    assert.deepEqual(observations.map(o => o.source.value), ['styles/site.css', 'src/theme.scss']);
  }
});

test('only explicit React styles are analyzed; comments, strings and arbitrary objects are ignored', () => {
  const observations = analyze(`// <p style={{ fontFamily: 'Comment' }} />
const text = "fontFamily: 'String'";
const unrelated = {fontFamily: 'Object'};
const Card = () => <p style={{color: 'red'}} />;`);
  assert.deepEqual(observations, []);
});

test('const primitives, quoted/computed keys and TS wrappers are supported without evaluating code', () => {
  const observations = analyze(`const family = 'Atlas'; const fontWeight = 650;
const Card = () => <p style={(({
  ['fontFamily']: family,
  fontWeight,
  "fontStyle": \`italic\`
}) as const) satisfies object} />;`);
  assert.deepEqual(usage(observations).map(o => o.value), ['Atlas', '650', 'italic']);
});

test('mutable bindings, function calls, dynamic templates, computed keys and spreads are indeterminate', () => {
  const observations = analyze(`let family = 'Atlas';
const Card = () => <p style={{
  fontFamily: family,
  fontStyle: getStyle(),
  font: \`16px \${theme.font}\`,
  [theme.key]: 'Atlas',
  ...theme.styles,
  fontWeight: 700
}} />;`);
  assert.deepEqual(observations.filter(o => o.kind === 'indeterminate').map(o => o.expression),
    ['family', 'getStyle()', '`16px ${theme.font}`', '[theme.key]', 'theme.styles']);
  assert.deepEqual(observations.at(-1).variants, [{ weight: '700' }]);
  assert.equal(analyze('const Card = () => <p style={theme.styles} />;')[0].expression, 'theme.styles');
});

test('React createElement supports JS and TS with imported aliases and respects shadowing', () => {
  for (const language of ['js', 'ts']) {
    const observations = analyze(`import React, { createElement as h } from 'react';
import * as R from 'react';
React.createElement('p', {style: {fontFamily: 'Atlas'}});
h('p', {style: {fontWeight: 600}});
R.createElement('p', {style: {fontStyle: 'italic'}});
function shadow(h) { return h('p', {style: {fontFamily: 'Fake'}}); }
unrelated.createElement('p', {style: {fontFamily: 'Fake'}});`, language);
    assert.deepEqual(usage(observations).map(o => o.value), ['Atlas', '600', 'italic']);
  }
});

test('next/font imports and loader calls are left to the Next analyzer', () => {
  const observations = analyze(`import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
const inter = Inter({ subsets: ['latin'] });
const local = localFont({ src: './Atlas.woff2' });
const Card = () => <p className={inter.className} style={{fontFamily: inter.style.fontFamily}} />;`);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].kind, 'indeterminate');
  assert.equal(observations[0].expression, 'inter.style.fontFamily');
  assert.ok(observations.every(o => !o.origin.startsWith('next/')));
});

test('CSS-wide and system shorthand values remain indeterminate instead of invented families', () => {
  for (const value of ['inherit', 'menu', 'caption', 'var(--font)']) {
    const observations = analyze(`const Card = () => <p style={{font: '${value}'}} />;`);
    assert.equal(usage(observations).length, 0);
    assert.equal(observations.at(-1).kind, 'indeterminate');
    assert.equal(observations.at(-1).expression, value);
  }
});

test('positions use UTF-16 columns, CRLF lines, and JSX in .js is supported', () => {
  const text = `// comment\r\nconst emoji = '😀'; const Card = () => <p style={{fontFamily: 'Atlas'}} />;`;
  assert.deepEqual(analyze(text, 'js')[0].location,
    { file: 'src/Card.js', line: 2, column: text.split('\r\n')[1].indexOf('fontFamily') + 1 });
});

async function snapshot(root) {
  return Promise.all((await readdir(root, { recursive: true })).sort().map(async path => {
    const file = join(root, path);
    const info = await stat(file);
    return [path, info.mtimeMs, info.isFile() ? await readFile(file, 'utf8') : null];
  }));
}

test('offline React/Vite fixture needs no Next or installed app dependencies; discovery visits each sheet once', async () => {
  const root = fileURLToPath(new URL('./fixtures/react-vite/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies.next, undefined);
  assert.deepEqual(await readdir(root), ['index.html', 'package.json', 'src', 'vite.config.ts']);
  const before = await snapshot(root);
  const visited = [];
  const result = await scan(root, [reactAnalyzer, {
    id: 'stylesheet-probe', languages: ['css', 'scss'], analyze(source) { visited.push(source.file); return []; },
  }]);
  assert.deepEqual(visited, ['src/Card.module.css', 'src/base.css']);
  assert.equal(result.files.filter(f => f.file === 'src/Card.module.css').length, 1);
  assert.ok(usage(result.observations).some(o => o.family === 'Atlas Sans'));
  assert.ok(usage(result.observations).some(o => o.cssModule?.className === 'title'));
  assert.ok(result.observations.some(o => o.kind === 'indeterminate' && o.expression === 'theme.font'));
  assert.ok(usage(result.observations).some(o => o.variants?.[0].weight === '600'));
  assert.deepEqual(await snapshot(root), before);
});
