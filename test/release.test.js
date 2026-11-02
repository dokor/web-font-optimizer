import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRelease } from '../scripts/check-release.mjs';

const manifest = {
  name: '@alelouet/web-font-optimizer', version: '0.1.0', license: 'MIT',
  repository: { url: 'git+https://github.com/dokor/web-font-optimizer.git' },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
};

test('a public stable package can publish only from its exact version tag', () => {
  assert.equal(validateRelease(manifest, { refType: 'tag', refName: 'v0.1.0' }), '@alelouet/web-font-optimizer@0.1.0');
  assert.equal(validateRelease({ ...manifest, private: false }, { refType: 'tag', refName: 'v0.1.0' }), '@alelouet/web-font-optimizer@0.1.0');
  for (const options of [{}, { refType: 'branch', refName: 'main' }, { refType: 'tag', refName: 'v0.2.0' }]) {
    assert.throws(() => validateRelease(manifest, options));
  }
});

test('a dry run permits branch verification without relaxing package metadata', () => {
  assert.equal(validateRelease(manifest, { dryRun: true, refType: 'branch', refName: 'main' }), '@alelouet/web-font-optimizer@0.1.0');
  for (const changed of [
    { name: 'web-font-optimizer' }, { private: true }, { license: undefined },
    { version: '0.1.0-beta.1' }, { version: '00.1.0' },
    { repository: { url: 'https://github.com/other/repository.git' } },
    { publishConfig: { access: 'restricted', registry: 'https://registry.npmjs.org/' } },
    { publishConfig: { access: 'public', registry: 'https://other.invalid/' } },
  ]) assert.throws(() => validateRelease({ ...manifest, ...changed }, { dryRun: true }));
});
