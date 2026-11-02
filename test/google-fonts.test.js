import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGoogleFontsUrl } from '@alelouet/web-font-optimizer';

const location = { file: 'src/style.css', line: 3, column: 14 };
const decode = url => decodeGoogleFontsUrl(url, location);

test('legacy CSS: multiple families, aliases, numeric weights and explicit italic', () => {
  const url = 'https://fonts.googleapis.com/css?family=Open+Sans:400,700italic|Lora:regular,i,b,bi|Roboto+Mono:300i&display=swap&subset=latin,cyrillic';
  const result = decode(url);
  assert.equal(result.url, url);
  assert.deepEqual(result.location, location);
  assert.equal(result.api, 'css');
  assert.equal(result.complete, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.display, 'swap');
  assert.deepEqual(result.families, [
    { family: 'Open Sans', variants: [
      { weight: '400', style: 'normal', subset: 'latin,cyrillic' },
      { weight: '700', style: 'italic', subset: 'latin,cyrillic' },
    ] },
    { family: 'Lora', variants: [
      { weight: '400', style: 'normal', subset: 'latin,cyrillic' },
      { weight: '400', style: 'italic', subset: 'latin,cyrillic' },
      { weight: '700', style: 'normal', subset: 'latin,cyrillic' },
      { weight: '700', style: 'italic', subset: 'latin,cyrillic' },
    ] },
    { family: 'Roboto Mono', variants: [{ weight: '300', style: 'italic', subset: 'latin,cyrillic' }] },
  ]);
});

test('CSS2: repeated families, tuples and authored variable ranges', () => {
  const result = decode('//fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,700&family=Roboto%20Slab:wght@100..900&family=Roboto+Flex:wdth,wght@75..100,450.5');
  assert.equal(result.api, 'css2');
  assert.equal(result.complete, true);
  assert.deepEqual(result.families, [
    { family: 'Inter', variants: [
      { style: 'normal', weight: '400' },
      { style: 'normal', weight: '700' },
      { style: 'italic', weight: '700' },
    ] },
    { family: 'Roboto Slab', variants: [{ weight: '100 900', style: 'normal' }] },
    { family: 'Roboto Flex', variants: [{ stretch: '75% 100%', weight: '450.5', style: 'normal' }] },
  ]);
});

test('defaults, percent encoding, http and repeated legacy family parameters', () => {
  assert.deepEqual(decode('http://fonts.googleapis.com/css?family=Open%20Sans&family=Lora:bolditalic').families, [
    { family: 'Open Sans', variants: [{ weight: '400', style: 'normal' }] },
    { family: 'Lora', variants: [{ weight: '700', style: 'italic' }] },
  ]);
  assert.deepEqual(decode('https://fonts.googleapis.com/css2?family=Inter:ital@1').families,
    [{ family: 'Inter', variants: [{ weight: '400', style: 'italic' }] }]);
});

test('partially understood requests retain known families, valid variants, URL and location', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;bad;700&family=Roboto+Flex:opsz,wght@14,600&family=Lora:wght&family=Literata';
  const result = decode(url);
  assert.equal(result.url, url);
  assert.deepEqual(result.location, location);
  assert.equal(result.complete, false);
  assert.deepEqual(result.families, [
    { family: 'Inter', variants: [{ weight: '400', style: 'normal' }, { weight: '700', style: 'normal' }] },
    { family: 'Roboto Flex', variants: [{ weight: '600', style: 'normal' }] },
    { family: 'Lora', variants: [] },
    { family: 'Literata', variants: [{ weight: '400', style: 'normal' }] },
  ]);
  assert.deepEqual(result.issues.map(issue => issue.expression), ['bad', 'opsz', 'wght']);
});

test('legacy unknown variants do not erase understood siblings', () => {
  const result = decode('https://fonts.googleapis.com/css?family=Inter:400,mystery,700i|Lora');
  assert.equal(result.complete, false);
  assert.deepEqual(result.families[0].variants, [{ weight: '400', style: 'normal' }, { weight: '700', style: 'italic' }]);
  assert.equal(result.issues[0].expression, 'mystery');
});

test('recognized but malformed URLs stay identifiable without throwing', () => {
  const suffixes = [
    '', '?family=', '?family=${dynamic}', '?family=Inter:wght@900..100',
    '?family=Inter:ital,wght@1', '?family=Inter:ital@2',
    '?family=Inter:wght,wght@400,700', '?family=Inter:wght@0',
    '?family=Inter:wdth@-10', '?family=Bad%ZZ', '?family=Bad%C3',
  ];
  for (const suffix of suffixes) {
    const url = `https://fonts.googleapis.com/css2${suffix}`;
    const result = decode(url);
    assert.equal(result.url, url);
    assert.deepEqual(result.location, location);
    assert.equal(result.complete, false, suffix);
    assert.ok(result.issues.length, suffix);
  }
});

test('unrelated URLs, lookalike hosts, credentials and non-HTTP schemes are not Google CSS requests', () => {
  for (const url of [
    '/css2?family=Inter', 'not a URL', 'https://fonts.gstatic.com/inter.woff2',
    'https://fonts.googleapis.com.evil.test/css2?family=Inter',
    'https://fonts.googleapis.com/other?family=Inter',
    'https://fonts.googleapis.com@evil.test/css2?family=Inter',
    'https://user@fonts.googleapis.com/css2?family=Inter',
    'ftp://fonts.googleapis.com/css2?family=Inter',
  ]) assert.equal(decode(url), undefined, url);
});
