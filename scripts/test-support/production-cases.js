import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./network-guard.cjs', import.meta.url));

export function snapshot(root) {
  return readdirSync(root, { recursive: true }).sort().map(path => {
    const file = join(root, path);
    const info = statSync(file);
    return [path, info.mtimeMs, info.isFile() ? readFileSync(file).toString('base64') : null];
  });
}

export function assertProductionReport(report, project) {
  assert.equal(report.version, 1);
  const observations = report.inventory.observations;
  assert.ok(observations.some(o => o.kind === 'usage' && o.family === 'Atlas'));
  assert.ok(observations.some(o => o.kind === 'declaration' && o.family === 'Lora' && o.origin === '@import'));
  const faces = observations.filter(o => o.kind === 'declaration' && o.family === 'Atlas');
  assert.equal(faces.length, 2);
  assert.deepEqual(new Set(faces.map(o => o.variants[0].unicodeRange)), new Set(['U+0000-00FF', 'U+0100-024F']));
  const fonts = report.inventory.resources.filter(r => r.source.value.includes('atlas-'));
  assert.equal(fonts.length, 2);
  assert.ok(fonts.every(r => r.sizeBytes > 0));
  const duplicate = report.diagnostics.find(d => d.ruleId === 'duplicate-load');
  assert.ok(duplicate);
  assert.equal(duplicate.confidence, 'certain');
  assert.deepEqual(duplicate.locations.map(l => [l.file, l.line]), [['duplicates.css', 1], ['duplicates.css', 2]]);
  assert.ok(!report.diagnostics.some(d => /Atlas/.test(d.message)), 'Atlas ranges and uses must not produce false positives.');
  assert.ok(report.diagnostics.every(d => d.locations.length && d.advice));
  if (project === 'next') {
    assert.ok(observations.some(o => o.kind === 'usage' && o.origin === 'next/font/className' && o.family === 'Inter'));
    const overlap = report.diagnostics.find(d => d.ruleId === 'possible-overlap' && /Inter/.test(d.message));
    assert.ok(overlap);
    assert.deepEqual(new Set(overlap.locations.map(l => l.file)), new Set(['index.html', 'app/layout.tsx']));
  } else {
    assert.ok(observations.some(o => o.kind === 'usage' && o.cssModule?.stylesheet === 'src/Card.module.css'));
    assert.ok(!observations.some(o => o.origin.startsWith('next/font')));
  }
}

/** Runs unchanged against dist/cli.js and the archive installed in a clean consumer. */
export function checkCliFixtures(cli, fixtures) {
  for (const project of ['react-vite', 'next']) {
    const root = join(fixtures, project);
    const before = snapshot(root);
    assert.equal(existsSync(join(root, 'node_modules')), false);
    function run(args, status) {
      const result = spawnSync(process.execPath, ['--require', guard, cli, ...args], {
        cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, FORCE_COLOR: '1' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, status, `${project}: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result;
    }
    let accepted;
    for (const ci of [false, true]) {
      for (const format of ['terminal', 'json']) {
        const result = run(['scan', '--report', format, ...(ci ? ['--fail-on-duplicates'] : [])], ci ? 1 : 0);
        assert.equal(result.stderr, '');
        if (format === 'json') {
          assert.doesNotMatch(result.stdout, /\x1b/);
          const report = JSON.parse(result.stdout);
          assertProductionReport(report, project);
          if (accepted) assert.deepEqual(report, accepted);
          accepted = report;
        } else {
          assert.match(result.stdout, /duplicates.css:1:/);
          assert.match(result.stdout, /duplicates.css:2:/);
          assert.match(result.stdout, /Atlas/);
          assert.match(result.stdout, /100 900/);
          assert.match(result.stdout, /certain/);
          assert.match(result.stdout, /Action :/);
        }
        if (!ci) continue;
        const clean = run(['scan', 'shared.css', '--report', format, '--fail-on-duplicates'], 0);
        assert.equal(clean.stderr, '');
        if (format === 'json') {
          const report = JSON.parse(clean.stdout);
          assert.deepEqual(report.diagnostics, []);
          assert.ok(report.inventory.resources.some(r => r.source.value.includes('atlas-latin') && r.sizeBytes > 0));
        }
      }
    }
    for (const format of ['terminal', 'json']) {
      const result = run(['scan', 'missing.css', '--report', format, '--fail-on-duplicates'], 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /missing.css/);
    }
    assert.deepEqual(snapshot(root), before, 'Auditing must not write or create project files.');
  }
}
