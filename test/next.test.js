import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scan } from 'web-font-optimizer';
import { nextAnalyzer } from 'web-font-optimizer/analyzers/next';

const analyze = (text, language = 'tsx', file = 'app/page.tsx') =>
  nextAnalyzer.analyze({ text, language, file });
const select = (observations, kind) => observations.filter(item => item.kind === kind);
const fixture = async name => analyze(await readFile(new URL(`./fixtures/next/${name}.tsx`, import.meta.url), 'utf8'));

test('Google aliases retain canonical family, all explicit variants, and instance identity', async () => {
  const observations = await fixture('google-alias');
  const [declaration] = select(observations, 'declaration');
  assert.equal(declaration.origin, 'next/font/google');
  assert.equal(declaration.family, 'Roboto Mono');
  assert.equal(declaration.display, 'swap');
  assert.equal(declaration.variants.length, 8);
  assert.deepEqual(declaration.variants[0], { weight: '400', style: 'normal', subset: 'latin' });
  assert.deepEqual(declaration.variants.at(-1), { weight: '700', style: 'italic', subset: 'latin-ext' });
  assert.deepEqual(declaration.location, { file: 'app/page.tsx', line: 3, column: 14 });
  const usages = select(observations, 'usage');
  assert.deepEqual(usages.map(item => item.origin), ['next/font/className', 'next/font/style']);
  assert.ok(usages.every(item => item.family === declaration.family && item.context === declaration.context));
  assert.equal(select(observations, 'indeterminate').length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(observations)), observations);
});

test('Google identity matches a decoded CDN family without inventing a CDN resource', async () => {
  const [declaration] = select(await fixture('google-alias'), 'declaration');
  const cdn = new URL('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap');
  const cdnFamily = cdn.searchParams.get('family').split(':')[0];
  assert.equal(declaration.family, cdnFamily);
  assert.equal(declaration.sources, undefined);
});

test('local multi-source declarations keep each path paired with its authored variant', async () => {
  const observations = await fixture('local-sources');
  const declarations = select(observations, 'declaration');
  assert.equal(declarations.length, 2);
  assert.match(declarations[0].family, /^local:app\/page\.tsx:/);
  assert.equal(declarations[0].family, declarations[1].family);
  assert.deepEqual(declarations.map(item => [item.sources, item.variants]), [
    [[{ kind: 'file', value: './fonts/heading-regular.woff2' }], [{ weight: '400', style: 'normal' }]],
    [[{ kind: 'file', value: '../assets/heading-variable.woff2' }], [{ weight: '100 900', style: 'italic' }]],
  ]);
  assert.deepEqual(select(observations, 'resource').map(item => item.source), declarations.flatMap(item => item.sources));
  assert.equal(select(observations, 'usage')[0].family, declarations[0].family);
  assert.equal(select(observations, 'indeterminate').length, 0);
});

test('exposing .variable is distinct from consuming it in CSS font-family', async () => {
  const observations = await fixture('css-variable');
  const variables = select(observations, 'variable');
  assert.deepEqual(variables.map(item => [item.action, item.origin, item.name]), [
    ['define', 'next/font/google', '--font-inter'],
    ['reference', 'next/font/variable', '--font-inter'],
    ['reference', 'font-family', '--font-inter'],
  ]);
  assert.equal(variables[0].value, 'Inter');
  assert.equal(variables[1].context, variables[0].context);
  assert.equal(select(observations, 'usage').length, 0);
  assert.equal(variables[2].location.line, 6);
});

test('exposure alone does not count as a font-family usage', () => {
  const observations = analyze(`import { Inter } from 'next/font/google';
    const font = Inter({ variable: '--font-inter' });
    export default () => <body className={font.variable} />;`);
  assert.equal(select(observations, 'usage').length, 0);
  assert.equal(select(observations, 'variable').length, 2);
  assert.equal(select(observations, 'variable').filter(item => item.origin === 'font-family').length, 0);
});

test('local single source inherits explicit defaults and gets a separate local identity', () => {
  const observations = analyze(`import renamed from 'next/font/local';
    const a = renamed({src: './a.woff2', weight: '100 900', style: 'oblique'});
    const b = renamed({src: './b.woff2'});
    export default () => <p className={a.className} style={b.style} />;`);
  const declarations = select(observations, 'declaration');
  assert.notEqual(declarations[0].family, declarations[1].family);
  assert.deepEqual(declarations[0].variants, [{ weight: '100 900', style: 'oblique' }]);
  assert.equal(declarations[1].variants, undefined);
  assert.deepEqual(select(observations, 'usage').map(item => item.family), declarations.map(item => item.family));
});

test('lexical binding avoids shadowed loaders and font instances', () => {
  const observations = analyze(`import { Inter as load } from 'next/font/google';
    const font = load({weight: '400'});
    function unrelated(load: Function, font: any) {
      load({weight: '900'});
      return <div className={font.className} style={font.style} />;
    }
    export default () => <div className={font.className} />;`);
  assert.equal(select(observations, 'declaration').length, 1);
  const usages = select(observations, 'usage');
  assert.equal(usages.length, 1);
  assert.equal(usages[0].location.line, 7);
});

test('namespace, loader aliases, returned-object aliases and member aliases are static', () => {
  const observations = analyze(`import * as google from 'next/font/google';
    import { default as local } from 'next/font/local';
    const load = google['Open_Sans'];
    const font = load({weight: '600'});
    const alias = font;
    const {className: cls, style: fontStyle} = alias;
    const family = font.style.fontFamily;
    const localInstance = local({src: './font.woff'});
    export default () => <main className={cls} style={{...fontStyle, fontFamily: family}}>
      <p className={localInstance['className']} />
    </main>;`);
  assert.equal(select(observations, 'declaration')[0].family, 'Open Sans');
  assert.equal(select(observations, 'usage').length, 4);
  assert.equal(select(observations, 'indeterminate').length, 0);
});

test('JS, JSX, TS and TSX work without a Next installation', () => {
  for (const language of nextAnalyzer.languages) {
    const observations = analyze(`import { Inter } from 'next/font/google'; const font = Inter({subsets:['latin']});`, language, `fonts.${language}`);
    assert.equal(select(observations, 'declaration')[0].family, 'Inter');
  }
});

test('type wrappers do not hide explicit values', () => {
  const observations = analyze(`import { Inter } from 'next/font/google';
    const font = Inter(({weight: ['400'], variable: '--font'} as const) satisfies Options);
    const alias = (font as unknown)!;
    export default () => <div className={alias.className} />;`);
  assert.deepEqual(select(observations, 'declaration')[0].variants, [{ weight: '400' }]);
  assert.equal(select(observations, 'usage').length, 1);
  assert.equal(select(observations, 'indeterminate').length, 0);
});

for (const [name, options, expression] of [
  ['dynamic weight', `{weight: selectedWeight, subsets: ['latin']}`, 'selectedWeight'],
  ['dynamic style', `{style: pickStyle()}`, 'pickStyle()'],
  ['dynamic subset', `{subsets: ['latin', subset]}`, 'subset'],
  ['dynamic variable', '{variable: `--font-${theme}`}', '`--font-${theme}`'],
  ['options identifier', 'config', 'config'],
  ['options spread', `{weight: '400', ...config}`, '...config'],
  ['shorthand', '{weight}', 'weight'],
  ['computed key', `{[key]: '400'}`, "[key]: '400'"],
]) {
  test(`${name} produces located indeterminate evidence`, () => {
    const observations = analyze(`import { Inter } from 'next/font/google';\nconst font = Inter(${options});`);
    const unknown = select(observations, 'indeterminate');
    assert.ok(unknown.some(item => item.expression === expression));
    assert.ok(unknown.every(item => item.location.line === 2 && item.location.column > 0 && item.reason.length > 0));
    assert.equal(select(observations, 'declaration')[0].family, 'Inter');
  });
}

test('a spread cannot leave overridden static variants or variable names in inventory', () => {
  const observations = analyze(`import { Inter } from 'next/font/google';
    const font = Inter({weight: '400', variable: '--wrong', ...config, style: 'italic'});`);
  assert.deepEqual(select(observations, 'declaration')[0].variants, [{ style: 'italic' }]);
  assert.equal(select(observations, 'variable').length, 0);
});

test('dynamic local sources preserve independent known files and partial descriptors', () => {
  const observations = analyze(`import local from 'next/font/local';
    const font = local({src: [
      {path: './regular.woff2', weight: selectedWeight, style: 'normal'},
      {path: getPath(), weight: '700'},
      ...moreFiles,
    ]});`);
  assert.deepEqual(select(observations, 'declaration')[0].sources, [{ kind: 'file', value: './regular.woff2' }]);
  assert.deepEqual(select(observations, 'declaration')[0].variants, [{ style: 'normal' }]);
  assert.deepEqual(select(observations, 'indeterminate').map(item => item.expression), ['selectedWeight', 'getPath()', '...moreFiles']);
});

test('React without Next imports and comments or strings mentioning Next produce nothing', () => {
  for (const text of [
    `import React from 'react'; const font = {className: 'a'}; export default () => <div className={font.className} />;`,
    `// import { Inter } from 'next/font/google';\nconst text = "next/font/local";`,
    `import { Inter } from 'not-next/font/google'; const font = Inter({});`,
    `import type { Inter } from 'next/font/google';`,
    `const load = require('next/font/local'); const font = load({src:'./a.woff2'});`,
  ]) assert.deepEqual(analyze(text), []);
});

test('mere member reads and unrelated JSX attributes do not imply application', () => {
  const observations = analyze(`import { Inter } from 'next/font/google';
    const font = Inter({});
    console.log(font.className, font.style);
    export default () => <div data-font={font.className} title={font.variable} />;`);
  assert.equal(select(observations, 'usage').length, 0);
  assert.equal(select(observations, 'variable').length, 0);
});

test('missing explicit variable names and local sources are indeterminate', () => {
  const observations = analyze(`import local from 'next/font/local';
    const font = local({}); export default () => <div className={font.variable} />;`);
  assert.equal(select(observations, 'indeterminate').length, 2);
});

test('locations use one-based UTF-16 columns with CRLF and non-BMP text', () => {
  const text = `import { Inter } from 'next/font/google';\r\nconst emoji = '😀'; const font = Inter({});`;
  const [declaration] = select(analyze(text), 'declaration');
  assert.deepEqual(declaration.location, {file: 'app/page.tsx', line: 2, column: text.split('\r\n')[1].indexOf('Inter(') + 1});
});

test('scan is read-only and never evaluates project code, loader options or font files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-next-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const text = `import { Inter } from 'next/font/google';
    import local from 'next/font/local';
    throw new Error('PROJECT MUST NEVER EXECUTE');
    const a = Inter({weight: (() => { throw new Error('NO EVALUATION'); })()});
    const b = local({src: './not-installed.woff2'});
    export default () => <div className={a.className} style={b.style} />;`;
  await writeFile(join(root, 'page.tsx'), text);
  const before = await stat(join(root, 'page.tsx'));
  const result = await scan(root, [nextAnalyzer]);
  assert.equal(select(result.observations, 'declaration').length, 2);
  assert.equal(select(result.observations, 'usage').length, 2);
  assert.equal(select(result.observations, 'indeterminate').length, 1);
  assert.deepEqual(await readdir(root), ['page.tsx']);
  assert.equal(await readFile(join(root, 'page.tsx'), 'utf8'), text);
  assert.equal((await stat(join(root, 'page.tsx'))).mtimeMs, before.mtimeMs);
});
