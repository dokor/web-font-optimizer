import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit, buildAuditReport, reactAnalyzer, scan } from 'web-font-optimizer';
import { cssAnalyzer } from 'web-font-optimizer/analyzers/css';
import { nextAnalyzer } from 'web-font-optimizer/analyzers/next';
import { resolveUsages } from '../dist/engine/families.js';
import { assertProductionReport, checkCliFixtures } from '../scripts/test-support/production-cases.js';

const fixtures = fileURLToPath(new URL('./fixtures/integration/', import.meta.url));
const css = text => cssAnalyzer.analyze({ file: 'style.css', language: 'css', text });
const next = text => nextAnalyzer.analyze({ file: 'page.tsx', language: 'tsx', text });

test('CSS declarations serve selectors and their own resource is not a second load', async () => {
  const observations = await css('@font-face { font-family: Atlas; src: url(atlas.woff2); } body { font-family: Atlas; }');
  assert.deepEqual((await buildAuditReport(observations)).diagnostics, []);
  const resource = observations.find(o => o.kind === 'resource');
  assert.deepEqual(resource.declarationLocation, observations.find(o => o.kind === 'declaration').location);
});

test('Google Fonts CSS escapes preserve the original proof and conditional import context', async () => {
  const raw = String.raw`https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700\26 display=swap`;
  const observations = await css(`@import url("${raw}") screen; body { font-family: Inter; }`);
  const declaration = observations.find(o => o.kind === 'declaration');
  assert.equal(declaration.family, 'Inter');
  assert.deepEqual(declaration.variants, [{ weight: '400', style: 'normal' }, { weight: '700', style: 'italic' }]);
  assert.equal(declaration.sources[0].value, raw);
  assert.match(declaration.context, /screen/);
  assert.equal(declaration.scope, undefined);
  assert.deepEqual(declaration.location, { file: 'style.css', line: 1, column: 1 });
  const partial = await css('@import "https://fonts.googleapis.com/css2?family=Inter:opsz@14";');
  assert.ok(partial.some(o => o.kind === 'indeterminate'));
  assert.ok(partial.some(o => o.kind === 'resource'));
});

test('React resources resolve relative to the importing file while CSS Module references remain root-relative', async () => {
  const root = fileURLToPath(new URL('./fixtures/react-vite/', import.meta.url));
  const { observations } = await scan(root, [reactAnalyzer]);
  const report = await buildAuditReport(observations, { root });
  const shared = report.inventory.resources.filter(r => r.source.value === 'base.css');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].locations.length, 2);
  assert.equal(shared[0].sizeBytes, (await stat(new URL('./fixtures/react-vite/src/base.css', import.meta.url))).size);
  assert.ok(!report.diagnostics.some(d => ['duplicate-load', 'possible-overlap'].includes(d.ruleId)));
});

test('Next variable exposure is not a use, but unique exposed variables can serve CSS consumers', async () => {
  const observations = await next(`import { Inter } from 'next/font/google'; const f = Inter({ variable: '--font-body' }); const view = <body className={f.variable}/>;`);
  assert.equal((await buildAuditReport(observations)).diagnostics.filter(d => d.ruleId === 'no-static-usage').length, 1);
  assert.deepEqual(resolveUsages(observations), []);
  const combined = [...observations, ...await css('body { font-family: var(--font-body); }')];
  const resolved = resolveUsages(combined).find(u => u.observation.kind === 'variable');
  assert.deepEqual(resolved.families, ['Inter']);
  assert.equal(resolved.dynamic, false);
  assert.deepEqual((await buildAuditReport(combined)).diagnostics, []);
  const unexposed = observations.filter(o => o.origin !== 'next/font/variable');
  assert.ok(resolveUsages([...unexposed, ...await css('body { font-family: var(--font-body); }')]).every(u => u.dynamic));
});

test('multiple exposed Next instances with one CSS name remain ambiguous', async () => {
  const observations = await next(`import { Inter, Lora } from 'next/font/google'; const a=Inter({variable:'--font'}); const b=Lora({variable:'--font'}); const view=<body className={a.variable + b.variable}/>;`);
  const usages = resolveUsages([...observations, ...await css('body { font-family: var(--font); }')]);
  assert.ok(usages.length && usages.every(u => u.dynamic && u.families.length === 0));
  const single = await next(`import { Inter } from 'next/font/google'; const a=Inter({variable:'--font'}); const view=<body className={a.variable}/>;`);
  const competing = resolveUsages([...single, ...await css(':root { --font: Lora; } body { font-family: var(--font); }')]);
  assert.ok(competing.filter(u => u.observation.kind === 'variable').every(u => u.dynamic));
});

test('identical CSS loads in separate files stay advisory', async () => {
  const text = '@font-face { font-family: Atlas; src: url(atlas.woff2); }';
  const observations = [];
  for (const file of ['a.css', 'b.css']) observations.push(...await cssAnalyzer.analyze({ file, text, language: 'css' }));
  const report = await buildAuditReport(observations);
  assert.ok(!report.diagnostics.some(d => d.ruleId === 'duplicate-load'));
  assert.ok(report.diagnostics.some(d => d.ruleId === 'possible-overlap'));
});

for (const project of ['react-vite', 'next']) test(`production API audits the ${project} reference project`, async () => {
  const path = fileURLToPath(new URL(`./fixtures/integration/${project}/`, import.meta.url));
  assertProductionReport(await audit(path), project);
});

test('production CLI: both projects, formats, exit statuses, no network and no writes', () => {
  checkCliFixtures(fileURLToPath(new URL('../dist/cli.js', import.meta.url)), fixtures);
});
