import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cssAnalyzer } from '@alelouet/web-font-optimizer/analyzers/css';
import { scan } from '@alelouet/web-font-optimizer';
import { fileURLToPath } from 'node:url';

const fixtureUrl = new URL('./fixtures/css/', import.meta.url);
const analyze = (text, language = 'css') => cssAnalyzer.analyze({ file: 'test.' + language, text, language });
async function fixture(name) {
  const text = await readFile(new URL(name, fixtureUrl), 'utf8');
  return cssAnalyzer.analyze({ file: name, language: name.endsWith('scss') ? 'scss' : 'css', text });
}
const ofKind = (observations, kind) => observations.filter(o => o.kind === kind);

test('font faces retain variable ranges, complementary Unicode ranges and ordered fallback sources', async () => {
  const observations = await fixture('faces.css');
  const [latin, extended] = ofKind(observations, 'declaration');
  assert.equal(latin.family, 'Atlas');
  assert.deepEqual(latin.location, { file: 'faces.css', line: 2, column: 1 });
  assert.deepEqual(extended.location, { file: 'faces.css', line: 10, column: 1 });
  assert.deepEqual(latin.variants, [{ weight: '100 900', style: 'normal', unicodeRange: 'U+0000-00FF' }]);
  assert.deepEqual(extended.variants, [{ weight: '100 900', unicodeRange: 'U+0100-024F' }]);
  assert.equal(latin.display, 'swap');
  assert.deepEqual(latin.sources, [
    { kind: 'local-name', value: 'Atlas' },
    { kind: 'file', value: './atlas-latin.woff2', format: 'woff2' },
    { kind: 'file', value: './atlas-latin.woff', format: 'woff' },
  ]);
  const resources = ofKind(observations, 'resource');
  assert.equal(resources.filter(r => r.role === 'font').length, 3);
  assert.equal(resources[2].source.kind, 'url');
  assert.deepEqual(resources[0].location, { file: 'faces.css', line: 4, column: 3 });
});

test('imports preserve undecoded URLs, local references and loading context', async () => {
  const observations = await fixture('faces.css');
  const imports = observations.filter(o => o.kind === 'resource' && o.role === 'stylesheet');
  assert.equal(imports[0].source.value, 'https://fonts.googleapis.com/css2?family=Atlas:wght@400;600&display=swap');
  assert.equal(imports[0].family, undefined);
  assert.deepEqual(imports[0].location, { file: 'faces.css', line: 16, column: 1 });
  assert.deepEqual(imports[1].source, { kind: 'file', value: './theme.css' });
  assert.match(imports[1].context, /screen/);
});

test('individual properties preserve fallback stacks and share their selector/media context', async () => {
  const uses = ofKind(await fixture('faces.css'), 'usage');
  assert.deepEqual(uses[0].familyStack, ['Atlas', 'Georgia', 'serif']);
  assert.equal(uses[0].context, '@media (min-width: 40em) > .title');
  assert.deepEqual(uses[0].location, { file: 'faces.css', line: 20, column: 5 });
  assert.deepEqual(uses[1].variants, [{ weight: '600' }]);
  assert.equal(uses[1].family, undefined);
  assert.equal(uses[1].context, uses[0].context);
  assert.deepEqual(uses[2].variants, [{ style: 'italic' }]);
});

test('CSS alias chain resolves the required shorthand and SCSS aliases respect nesting', async () => {
  const observations = await fixture('aliases.scss');
  const uses = ofKind(observations, 'usage');
  assert.deepEqual(uses[0], {
    kind: 'usage', origin: 'font', context: '.title', family: 'Atlas',
    familyStack: ['Atlas', 'serif'], variants: [{ style: 'italic', weight: '600' }],
    location: { file: 'aliases.scss', line: 10, column: 3 },
  });
  assert.deepEqual(uses[1].familyStack, ['Atlas', 'sans-serif']);
  assert.deepEqual(uses[2].variants, [{ weight: '600' }]);
  assert.equal(uses[3].family, 'Nested');
  assert.equal(uses[3].context, '.sass > .nested');
  const references = observations.filter(o => o.kind === 'variable' && o.action === 'reference');
  assert.deepEqual(references.find(r => r.name === '--font-body').location,
    { file: 'aliases.scss', line: 10, column: 29 });
});

test('CSS Module preserves static evidence alongside cycles, missing aliases, interpolation and overloads', async () => {
  const observations = await fixture('card.module.scss');
  const uses = ofKind(observations, 'usage');
  assert.equal(uses[0].family, 'Static');
  assert.deepEqual(uses[0].location, { file: 'card.module.scss', line: 6, column: 3 });
  assert.equal(uses.length, 3);
  const unknown = ofKind(observations, 'indeterminate');
  assert.equal(unknown.length, 4);
  assert.match(unknown[0].reason, /Cycle/);
  assert.equal(unknown[0].expression, 'var(--cycle-a)');
  assert.deepEqual(unknown[0].location, { file: 'card.module.scss', line: 11, column: 3 });
  assert.match(unknown[1].reason, /absent/);
  assert.match(unknown[2].reason, /Interpolation/);
  assert.match(unknown[3].reason, /surchargé/);
});

test('global competing CSS bindings and conditional Sass never become certain families', async () => {
  const css = await analyze(':root { --f: Atlas } .dark { --f: Other } .body { font-family: var(--f) }');
  assert.equal(ofKind(css, 'usage').length, 0);
  assert.equal(ofKind(css, 'indeterminate').length, 1);
  const scss = await analyze('@mixin fonts { font-family: Atlas; } .ok { font-family: Known; }', 'scss');
  assert.equal(ofKind(scss, 'indeterminate').length, 1);
  assert.equal(ofKind(scss, 'usage')[0].family, 'Known');
});

test('shorthand supports multiword families, quoted commas and optional line height', async () => {
  const observations = await analyze('.a { font: oblique 10deg bold 1rem / 1.5 Open Sans, "A, B", serif; }');
  assert.deepEqual(ofKind(observations, 'usage')[0].familyStack, ['Open Sans', 'A, B', 'serif']);
  assert.deepEqual(ofKind(observations, 'usage')[0].variants, [{ style: 'oblique 10deg', weight: 'bold' }]);
  const fallback = await analyze('.a { font-family: var(--absent, "Atlas", serif); }');
  assert.deepEqual(ofKind(fallback, 'usage')[0].familyStack, ['Atlas', 'serif']);
});

test('scan accepts the analyzer through the shared registry for every fixture', async () => {
  const result = await scan(fileURLToPath(fixtureUrl), [cssAnalyzer]);
  assert.equal(result.files.length, 3);
  assert.ok(result.observations.some(o => o.kind === 'declaration' && o.family === 'Atlas'));
  assert.ok(result.observations.some(o => o.location.file === 'card.module.scss'));
});

test('conditional Sass assignments and repeated selector bindings remain indeterminate', async () => {
  const sass = await analyze('$f: Atlas; @if $theme { $f: Other; } .body { font-family: $f; }', 'scss');
  assert.equal(ofKind(sass, 'usage').length, 0);
  assert.equal(ofKind(sass, 'indeterminate').length, 1);
  const css = await analyze('.body { --f: Atlas !important } .body { --f: Other; font-family: var(--f) }');
  assert.equal(ofKind(css, 'usage').length, 0);
});

test('declaration positions use UTF-16 columns and CRLF line endings', async () => {
  const observations = await analyze('/* 🦉 */ .a { font-family: Atlas; }\r\n.b { font-weight: 500; }');
  const uses = ofKind(observations, 'usage');
  assert.deepEqual(uses.map(o => o.location), [
    { file: 'test.css', line: 1, column: 15 },
    { file: 'test.css', line: 2, column: 6 },
  ]);
});

test('unresolved properties keep other static declarations, and invalid syntax reports its source', async () => {
  const observations = await analyze('.a { font-family: theme(font); font-weight: 500; }');
  assert.equal(ofKind(observations, 'usage')[0].variants[0].weight, '500');
  assert.equal(ofKind(observations, 'indeterminate')[0].expression, 'theme(font)');
  const broken = await analyze('.a { font-family:');
  assert.equal(broken[0].kind, 'indeterminate');
  assert.equal(broken[0].location.file, 'test.css');
});
