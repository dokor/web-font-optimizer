import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAuditReport } from 'web-font-optimizer';

const location = (line, file = 'styles.css') => ({ file, line, column: 1 });
const source = (value, format = 'woff2') => ({ kind: 'file', value, format });
const face = (line, extra = {}) => ({ kind: 'declaration', origin: '@font-face', family: 'Atlas',
  sources: [source('atlas.woff2')], variants: [{ weight: '400' }], location: location(line), ...extra });
const usage = (line, extra = {}) => ({ kind: 'usage', origin: 'font-family', family: 'Atlas',
  location: location(line), ...extra });
const resource = (line, extra = {}) => ({ kind: 'resource', origin: '@import', role: 'stylesheet',
  source: { kind: 'url', value: 'https://fonts.googleapis.com/css2?family=Atlas:wght@400' },
  location: location(line), ...extra });
const rule = (report, id) => report.diagnostics.filter(d => d.ruleId === id);
const loads = report => report.diagnostics.filter(d => ['duplicate-load', 'possible-overlap'].includes(d.ruleId));

test('two identical imports in one context give one certain diagnostic with both locations', async () => {
  const a = resource(1, { context: 'document' }), b = resource(3, { context: 'document' });
  const report = await buildAuditReport([b, a]);
  assert.deepEqual(report.diagnostics, [{ ruleId: 'duplicate-load', severity: 'warning', confidence: 'certain',
    locations: [a.location, b.location], message: 'Chargement identique répété dans un même contexte (@import).',
    advice: 'Vérifier les emplacements puis conserver une seule déclaration ou un seul import dans ce contexte.' }]);
  assert.equal(report.inventory.resources.length, 1);
  assert.deepEqual(report.inventory.resources[0].locations, [a.location, b.location]);
});

test('a duplicate analyzer observation does not invent a second import', async () => {
  assert.deepEqual((await buildAuditReport([resource(1), resource(1)])).diagnostics, []);
});

test('local paths resolve from their evidence file before comparing loads', async () => {
  const a = resource(1, { context: 'document', source: source('font.css'), location: location(1, 'a/main.css') });
  const b = resource(2, { context: 'document', source: source('font.css'), location: location(2, 'b/main.css') });
  assert.deepEqual(loads(await buildAuditReport([a, b])), []);
  const shared = await buildAuditReport([
    { ...a, source: source('../fonts/shared.css') }, { ...b, source: source('../fonts/shared.css') },
  ]);
  assert.equal(rule(shared, 'duplicate-load').length, 1);
});

test('a preload and a font declaration are distinct mechanisms without a duplicate warning', async () => {
  const report = await buildAuditReport([face(1), resource(2, { role: 'preload', source: source('atlas.woff2') }), usage(3)]);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.inventory.resources.length, 1);
});

test('CDN/Next overlap is advisory, includes both origins and both locations', async () => {
  const variants = [{ weight: '400', style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF' }];
  const cdn = face(1, { origin: 'google-fonts', context: 'document', variants,
    sources: [{ kind: 'url', value: 'https://fonts.gstatic.com/atlas.woff2' }] });
  const next = face(4, { origin: 'next/font/google', context: 'document', sources: undefined, variants });
  const report = await buildAuditReport([cdn, next, usage(9, { context: 'document', variants: [{ weight: '400' }] })]);
  assert.equal(rule(report, 'duplicate-load').length, 0);
  const [diagnostic] = rule(report, 'possible-overlap');
  assert.equal(diagnostic.severity, 'info');
  assert.equal(diagnostic.confidence, 'probable');
  assert.deepEqual(diagnostic.locations, [cdn.location, next.location]);
  assert.match(diagnostic.message, /google-fonts.*next\/font\/google/);
});

test('a stylesheet resource with family evidence can overlap a Next declaration', async () => {
  const cdn = resource(1, { family: 'Atlas', origin: 'google-fonts' });
  const next = face(2, { origin: 'next/font/google', sources: undefined });
  const report = await buildAuditReport([cdn, next]);
  const [diagnostic] = rule(report, 'possible-overlap');
  assert.equal(diagnostic.confidence, 'possible');
  assert.equal(diagnostic.severity, 'info');
});

test('known stylesheet families satisfy usages without a separate face declaration', async () => {
  assert.deepEqual((await buildAuditReport([resource(1, { family: 'Atlas' }), usage(2)])).diagnostics, []);
});

test('different files or descriptor ranges do not become duplicates just by sharing a family', async () => {
  const report = await buildAuditReport([face(1), face(2, { sources: [source('other.woff2')] }), usage(3)]);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.inventory.resources.length, 2);
  const disjoint = await buildAuditReport([face(1, { variants: [{ weight: '100 400' }] }),
    face(2, { origin: 'next/font/google', sources: undefined, variants: [{ weight: '500 900' }] }), usage(3)]);
  assert.deepEqual(loads(disjoint), []);
});

test('complementary Unicode ranges and subsets remain separate without a load warning', async () => {
  const report = await buildAuditReport([
    face(1, { variants: [{ weight: '400', unicodeRange: 'U+0000-00FF', subset: 'latin' }] }),
    face(2, { origin: 'next/font/google', sources: [source('atlas-ext.woff2')],
      variants: [{ weight: '400', unicodeRange: 'U+0100-024F', subset: 'latin-ext' }] }), usage(3),
  ]);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.inventory.resources.length, 2);
  assert.equal(report.inventory.observations.filter(o => o.kind === 'declaration').length, 2);
});

test('Unicode wildcards are disjoint and malformed ranges remain ambiguous', async () => {
  const next = face(2, { origin: 'next/font/google', sources: undefined, variants: [{ unicodeRange: 'U+01??' }] });
  assert.equal(loads(await buildAuditReport([face(1, { variants: [{ unicodeRange: 'U+00??' }] }), next])).length, 0);
  const report = await buildAuditReport([face(1, { variants: [{ unicodeRange: 'unknown' }] }), next]);
  assert.equal(rule(report, 'possible-overlap')[0].confidence, 'possible');
});

test('a variable weight range covers the used weight without inventing unknown descriptors', async () => {
  const report = await buildAuditReport([face(1, { variants: [{ weight: '100 900' }] }),
    usage(2, { family: '"ATLAS"', variants: [{ weight: '700', style: 'normal', stretch: '100%' }] })]);
  assert.deepEqual(report.diagnostics, []);
});

test('only the unused variant is reported, always with verification advice', async () => {
  const report = await buildAuditReport([face(1, { variants: [{ weight: '400' }, { weight: '700' }] }),
    usage(2, { variants: [{ weight: 'normal' }] })]);
  assert.equal(report.diagnostics.length, 1);
  const [diagnostic] = rule(report, 'no-static-usage');
  assert.match(diagnostic.message, /weight=700/);
  assert.equal(diagnostic.severity, 'info');
  assert.equal(diagnostic.confidence, 'possible');
  assert.match(diagnostic.advice, /avant toute suppression/);
});

test('a weight without a family never creates an inferred usage', async () => {
  const report = await buildAuditReport([usage(1, { family: undefined, variants: [{ weight: '700' }] })]);
  assert.deepEqual(report.diagnostics, []);
});

test('system stacks and CSS-wide values need no declarations', async () => {
  for (const familyStack of [
    ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Arial', 'sans-serif'],
    ['ui-monospace', '"Courier New"', 'monospace'], ['inherit'], ['unset'],
  ]) assert.deepEqual((await buildAuditReport([usage(1, { family: undefined, familyStack })])).diagnostics, []);
});

test('quoted generic names remain authored families, and all custom stack entries are checked', async () => {
  const report = await buildAuditReport([usage(1, { familyStack: ['"serif"', 'Atlas', 'sans-serif'] })]);
  assert.equal(rule(report, 'undeclared-family').length, 2);
  assert.ok(report.diagnostics.every(d => d.severity === 'info' && d.confidence === 'possible'));
});

test('two fallback formats retain authored order and do not create duplicate loads', async () => {
  const sources = [source('atlas.woff2'), source('atlas.woff', 'woff')];
  const report = await buildAuditReport([face(1, { sources }), usage(2)]);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.inventory.resources.length, 2);
  assert.deepEqual(report.inventory.observations.find(o => o.kind === 'declaration').sources, sources);
});

test('unknown dynamic values prevent unsafe unused or undeclared findings in their scope', async () => {
  for (const dynamic of [
    { kind: 'indeterminate', origin: 'font-family', expression: 'theme.font', reason: 'runtime', location: location(2) },
    usage(2, { family: 'var(--runtime-font)' }),
    usage(2, { family: '$font' }),
    { kind: 'variable', action: 'reference', name: '--font', origin: 'var()', location: location(2) },
  ]) assert.deepEqual((await buildAuditReport([face(1), dynamic])).diagnostics, []);
});

test('resolved variables, aliases and explicit family evidence count as usages', async () => {
  const define = (name, value) => ({ kind: 'variable', action: 'define', name, value, origin: 'custom-property', location: location(2) });
  const report = await buildAuditReport([face(1), define('--base', '"Atlas", sans-serif'), define('--alias', 'var(--base)'),
    usage(3, { family: 'var(--alias)' })]);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual((await buildAuditReport([face(1), { kind: 'variable', action: 'reference', name: '--generated',
    family: 'Atlas', origin: 'next/font', location: location(4) }])).diagnostics, []);
});

test('cyclic or conflicting variable definitions remain unresolved and advisory', async () => {
  const define = (line, name, value) => ({ kind: 'variable', action: 'define', name, value, origin: 'custom-property', location: location(line) });
  for (const definitions of [
    [define(2, '--a', 'var(--b)'), define(3, '--b', 'var(--a)')],
    [define(2, '--a', 'Atlas'), define(3, '--a', 'Other')],
  ]) assert.deepEqual((await buildAuditReport([face(1), ...definitions, usage(4, { family: 'var(--a, Atlas)' })])).diagnostics, []);
});

test('different contexts only suggest overlap and do not satisfy usages in another scope', async () => {
  const report = await buildAuditReport([face(1, { context: 'component-a' }),
    face(2, { origin: 'next/font/google', context: 'component-b' }),
    usage(3, { context: 'component-b' })]);
  assert.equal(loads(report).length, 1);
  assert.equal(loads(report)[0].confidence, 'possible');
  assert.equal(loads(report)[0].severity, 'info');
  assert.deepEqual(rule(report, 'no-static-usage').map(d => d.locations), [[location(1)]]);
  const missing = await buildAuditReport([face(1, { context: 'a' }), usage(2, { context: 'b' })]);
  assert.equal(rule(missing, 'undeclared-family').length, 1);
});

test('a scoped variable overrides a global value without hiding a different scope', async () => {
  const define = (line, value, context) => ({ kind: 'variable', action: 'define', name: '--font', value,
    origin: 'custom-property', location: location(line), ...(context ? { context } : {}) });
  const report = await buildAuditReport([face(1, { context: 'a' }), define(2, 'Other'), define(3, 'Atlas', 'a'),
    usage(4, { context: 'a', family: 'var(--font)' })]);
  assert.deepEqual(report.diagnostics, []);
});

test('unrelated dynamic scopes do not suppress findings, and definitions alone are not uses', async () => {
  const report = await buildAuditReport([face(1, { context: 'a' }), usage(2, { context: 'b', family: 'var(--unknown)' }),
    { kind: 'variable', action: 'define', name: '--font', value: 'Atlas', origin: 'custom-property', location: location(3) }]);
  assert.equal(rule(report, 'no-static-usage').length, 1);
});

test('a shared local file is sized once; remote, missing and directory resources stay unknown', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'styles'));
  await mkdir(join(root, 'fonts'));
  const font = join(root, 'fonts', 'atlas.woff2');
  await writeFile(font, Buffer.alloc(123, 7));
  const before = await stat(font);
  const remote = { kind: 'url', value: 'https://example.invalid/atlas.woff2' };
  const report = await buildAuditReport([
    face(1, { location: location(1, 'styles/a.css'), sources: [source('../fonts/atlas.woff2')] }),
    face(2, { location: location(2, 'b.css'), sources: [source('fonts/atlas.woff2')] }),
    resource(3, { role: 'preload', source: source('fonts/./atlas.woff2') }),
    resource(4, { role: 'font', source: remote }),
    resource(5, { role: 'font', source: source('missing.woff2') }),
    resource(6, { role: 'font', source: source('fonts') }),
  ], { root });
  const sized = report.inventory.resources.filter(r => r.sizeBytes !== undefined);
  assert.equal(sized.length, 1);
  assert.equal(sized[0].sizeBytes, 123);
  assert.equal(sized[0].locations.length, 3);
  assert.equal(report.inventory.resources.length, 4);
  assert.ok(report.inventory.resources.filter(r => r !== sized[0]).every(r => !Object.hasOwn(r, 'sizeBytes')));
  assert.equal((await stat(font)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(font), Buffer.alloc(123, 7));
});

test('an inaccessible root or outside file does not abort the audit or expose its size', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'outside.woff2'), 'private');
  await mkdir(join(root, 'project'));
  const report = await buildAuditReport([face(1, { sources: [source('../outside.woff2')] })], { root: join(root, 'project') });
  assert.ok(!Object.hasOwn(report.inventory.resources[0], 'sizeBytes'));
  const missing = await buildAuditReport([face(1)], { root: join(root, 'missing') });
  assert.equal(missing.inventory.resources.length, 1);
  assert.equal(rule(missing, 'no-static-usage').length, 1);
});

test('sized shared resources have byte-identical inventory after reordering evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'font-resource-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'atlas.woff2'), 'font');
  const evidence = [face(1), resource(2, { source: source('./atlas.woff2'), role: 'preload' }), usage(3)];
  const a = await buildAuditReport(evidence, { root });
  const b = await buildAuditReport([...evidence].reverse(), { root });
  assert.equal(a.inventory.resources[0].sizeBytes, 4);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('every diagnostic obeys the shared contract and stable rule IDs', async () => {
  const report = await buildAuditReport([resource(1), resource(2), face(3),
    face(4, { origin: 'next/font/google', sources: undefined }), usage(5, { family: 'Unknown' })]);
  assert.deepEqual(new Set(report.diagnostics.map(d => d.ruleId)),
    new Set(['duplicate-load', 'possible-overlap', 'no-static-usage', 'undeclared-family']));
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  for (const diagnostic of report.diagnostics) {
    assert.ok(diagnostic.locations.length);
    assert.ok(diagnostic.message.length && diagnostic.advice.length);
    assert.ok(['info', 'warning', 'error'].includes(diagnostic.severity));
    assert.ok(['possible', 'probable', 'certain'].includes(diagnostic.confidence));
  }
});

test('all permutations of mixed evidence give byte-identical JSON and leave inputs untouched', async () => {
  const input = [resource(1, { context: 'document' }), resource(2, { context: 'document' }),
    face(3), face(4, { origin: 'next/font/google', sources: undefined }), usage(5, { family: 'Unknown' })];
  const original = structuredClone(input);
  function* permutations(items) {
    if (!items.length) { yield []; return; }
    for (let i = 0; i < items.length; i++) {
      for (const rest of permutations(items.filter((_, j) => j !== i))) yield [items[i], ...rest];
    }
  }
  const expected = JSON.stringify(await buildAuditReport(input));
  for (const permutation of permutations(input)) assert.equal(JSON.stringify(await buildAuditReport(permutation)), expected);
  assert.deepEqual(input, original);
});
