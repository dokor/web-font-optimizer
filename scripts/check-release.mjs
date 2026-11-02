import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateRelease(manifest, { dryRun = false, refType, refName } = {}) {
  assert.equal(manifest.name, '@alelouet/web-font-optimizer', 'Unexpected npm package name.');
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable releases are supported.');
  assert.notEqual(manifest.private, true, 'The package must not be private.');
  assert.equal(manifest.license, 'MIT', 'The selected license must be present.');
  assert.equal(manifest.repository?.url, 'git+https://github.com/dokor/web-font-optimizer.git');
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org/');
  if (!dryRun) {
    assert.equal(refType, 'tag', 'Publishing requires a version tag.');
    assert.equal(refName, `v${manifest.version}`, 'The tag must match package.json exactly.');
  }
  return `${manifest.name}@${manifest.version}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const spec = validateRelease(manifest, {
    dryRun: process.argv.slice(2).includes('--dry-run'),
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
  });
  await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  console.log(`Release configuration verified: ${spec}`);
}
