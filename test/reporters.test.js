import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { exampleReport } from '@alelouet/web-font-optimizer/examples/report-v1';
import { getExitCode, renderJson, renderTerminal, runCli } from '@alelouet/web-font-optimizer/reporters';

const empty = { version: 1, inventory: { observations: [], resources: [] }, diagnostics: [] };
const duplicate = JSON.parse(await readFile(new URL('./fixtures/duplicate-report.json', import.meta.url), 'utf8'));

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function capture(args, report) {
  let stdout = '';
  let stderr = '';
  const targets = [];
  return runCli(args, {
    audit: target => { targets.push(target); return report; },
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
  }).then(code => ({ code, stdout, stderr, targets }));
}

test('empty and warning-only reports remain readable and accepted with the CI flag', async () => {
  for (const report of [empty, exampleReport]) {
    const before = structuredClone(report);
    freeze(report);
    for (const format of ['terminal', 'json']) {
      const result = await capture(['scan', '--report', format, '--fail-on-duplicates'], report);
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.deepEqual(result.targets, ['.']);
      if (format === 'json') assert.deepEqual(JSON.parse(result.stdout), before);
      else if (report === empty) {
        assert.match(result.stdout, /Aucune observation/);
        assert.match(result.stdout, /Aucune ressource/);
        assert.match(result.stdout, /Aucun diagnostic/);
      } else {
        assert.match(result.stdout, /src\/body\.css:2:3/);
        assert.match(result.stdout, /certitude possible/);
        assert.match(result.stdout, /Action : Vérifier si Atlas/);
      }
    }
    assert.deepEqual(report, before);
  }
});

test('a certain duplicate changes only the exit status when CI is enabled', async () => {
  freeze(duplicate);
  for (const format of ['terminal', 'json']) {
    const args = ['scan', 'project', '--report', format];
    const normal = await capture(args, duplicate);
    const ci = await capture([...args, '--fail-on-duplicates'], duplicate);
    assert.equal(normal.code, 0);
    assert.equal(ci.code, 1);
    assert.equal(ci.stderr, '');
    assert.deepEqual(ci.targets, ['project']);
    assert.equal(ci.stdout, normal.stdout);
    if (format === 'json') {
      assert.deepEqual(JSON.parse(ci.stdout), duplicate);
      assert.doesNotMatch(ci.stdout, /\x1b/);
    } else {
      const diagnostics = ci.stdout.split('Diagnostics :')[1];
      assert.match(diagnostics, /avertissement ; certitude certaine.*duplicate-load/);
      assert.match(diagnostics, /src\/fonts\.css:2:1\n +Origine : @font-face\n +Famille : Atlas/);
      assert.match(diagnostics, /src\/copy\.css:12:3/);
      assert.match(diagnostics, /graisse 400, style normal, chasse 100%, unicode-range U\+0000-00FF, sous-ensemble latin/);
      assert.match(diagnostics, /Action : Conserver une seule déclaration partagée/);
    }
  }
});

test('CI policy uses the rule and certainty, independently of severity', () => {
  for (const ruleId of ['duplicate-load', 'possible-overlap', 'no-static-usage', 'undeclared-family']) {
    for (const confidence of ['possible', 'probable', 'certain']) {
      for (const severity of ['info', 'warning', 'error']) {
        const report = { ...empty, diagnostics: [{ ...duplicate.diagnostics[0], ruleId, confidence, severity }] };
        assert.equal(getExitCode(report), 0);
        assert.equal(getExitCode(report, { failOnDuplicates: true }),
          ruleId === 'duplicate-load' && confidence === 'certain' ? 1 : 0);
      }
    }
  }
});

test('terminal preserves observations, variant ranges, fallback order and unknown/zero sizes', () => {
  const location = { file: 'src/dynamic.tsx', line: 4, column: 9 };
  const source = { kind: 'url', value: 'https://example.test/atlas.woff2' };
  const report = {
    ...empty,
    inventory: {
      observations: [
        { ...duplicate.inventory.observations[0], variants: [{ weight: '100 900' }], sources: [
          { kind: 'local-name', value: 'Atlas' },
          { kind: 'file', value: './atlas.woff2', format: 'woff2' },
          { kind: 'file', value: './atlas.woff', format: 'woff' },
        ] },
        exampleReport.inventory.observations[0],
        { kind: 'resource', origin: 'preload', location, role: 'preload', source },
        { kind: 'variable', origin: 'css-variable', location, action: 'define', name: '--font', value: 'Atlas' },
        { kind: 'indeterminate', origin: 'style', location, expression: 'theme.font\n+fallback', reason: 'Expression dynamique.' },
      ],
      resources: [
        { source, locations: [location] },
        { source: { kind: 'file', value: './empty.woff2' }, sizeBytes: 0, locations: [location] },
      ],
    },
  };
  freeze(report);
  const output = renderTerminal(report);
  assert.match(output, /graisse 100 900/);
  assert.match(output, /Affichage : swap/);
  assert.match(output, /local-name "Atlas"[\s\S]*file "\.\/atlas\.woff2" \(format : woff2\)[\s\S]*file "\.\/atlas\.woff" \(format : woff\)/);
  assert.match(output, /Pile : "Atlas" → "serif"/);
  assert.match(output, /Rôle : preload/);
  assert.match(output, /Variable \(define\) : --font = Atlas/);
  assert.match(output, /Expression : theme.font\\n\+fallback/);
  assert.match(output, /Raison : Expression dynamique/);
  assert.match(output, /https:\/\/example.test\/atlas.woff2" — taille inconnue/);
  assert.match(output, /empty.woff2" — 0 octet\(s\)/);
  assert.match(output, /Les tailles sur disque ne mesurent pas une économie réseau/);
  assert.deepEqual(JSON.parse(renderJson(report)), report);
});

test('an unlinked diagnostic remains visible without inventing family or variants', () => {
  const output = renderTerminal({ ...empty, diagnostics: duplicate.diagnostics });
  assert.match(output, /src\/fonts\.css:2:1/);
  assert.match(output, /Conserver une seule déclaration partagée/);
  assert.doesNotMatch(output, /Famille :|Variante :/);
});

test('renderers are deterministic and do not emit terminal control sequences', () => {
  const report = structuredClone(exampleReport);
  report.diagnostics[0].message = '\x1b[31mAtlas\r\n\u009b31m';
  const terminal = renderTerminal(report);
  const json = renderJson(report);
  assert.equal(renderTerminal(report), terminal);
  assert.equal(renderJson(report), json);
  assert.doesNotMatch(terminal, /\x1b|\r|[\u007f-\u009f]/);
  assert.doesNotMatch(json, /\x1b/);
  assert.deepEqual(JSON.parse(json), report);
});

test('options can surround the target and -- disambiguates a path', async () => {
  for (const [args, target] of [
    [['scan', '--report=json', '--fail-on-duplicates', 'a project'], 'a project'],
    [['scan', '--report', 'json', '--', '-fonts.css'], '-fonts.css'],
  ]) {
    const result = await capture(args, empty);
    assert.equal(result.code, 0);
    assert.deepEqual(result.targets, [target]);
    assert.deepEqual(JSON.parse(result.stdout), empty);
  }
});

test('help and invalid options never call the audit pipeline', async () => {
  for (const args of [['--help'], ['scan', '--help'], ['scan', '--report=json', '-h']]) {
    const result = await capture(args, empty);
    assert.equal(result.code, 0);
    assert.deepEqual(result.targets, []);
    assert.match(result.stdout, /Codes de sortie : 0.*1[\s\S]*2 = erreur/);
  }
  for (const args of [
    [], ['other'], ['scan', '--unknown'], ['scan', 'a', 'b'], ['scan', ''],
    ['scan', '--report'], ['scan', '--report', 'xml'], ['scan', '--report='],
    ['scan', '--report=json', '--report=terminal'], ['scan', '--fail-on-duplicates=true'],
  ]) {
    const result = await capture(args, empty);
    assert.equal(result.code, 2);
    assert.deepEqual(result.targets, []);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Arguments invalides.*Usage/);
  }
});

test('audit failures use stderr and status 2 in both formats, even with CI enabled', async () => {
  for (const format of ['terminal', 'json']) {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['scan', '--report', format, '--fail-on-duplicates'], {
      audit: async () => { throw new Error('Lecture impossible : src/fonts.css'); },
      stdout: text => { stdout += text; },
      stderr: text => { stderr += text; },
    });
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /Lecture impossible : src\/fonts\.css/);
  }
});
