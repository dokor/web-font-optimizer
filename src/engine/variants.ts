import type { Variant } from '../contracts.js';

type Range = readonly [number, number];
type Overlap = 'yes' | 'no' | 'unknown';

function range(value: string | undefined, aliases: Record<string, string> = {}): Range | undefined {
  if (value === undefined) return;
  const text = value.trim().toLowerCase();
  if (!text) return;
  const numbers = (aliases[text] ?? text).split(/\s+/).map(n => Number(n.replace(/%$/, '')));
  if (numbers.length < 1 || numbers.length > 2 || numbers.some(n => !Number.isFinite(n))) return;
  const [min, max = min] = numbers;
  if (min === undefined || max === undefined || min > max) return;
  return [min, max];
}

function intersects(a: Range | undefined, b: Range | undefined): Overlap {
  if (!a || !b) return 'unknown';
  return a[0] <= b[1] && b[0] <= a[1] ? 'yes' : 'no';
}

function unicode(value: string | undefined): Range[] | undefined {
  if (value === undefined) return;
  const ranges: Range[] = [];
  for (const part of value.split(',')) {
    const match = /^\s*U\+([\da-f?]{1,6})(?:-([\da-f]{1,6}))?\s*$/i.exec(part);
    if (!match?.[1] || (match[2] && match[1].includes('?'))) return;
    const min = parseInt(match[1].replace(/\?/g, '0'), 16);
    const max = parseInt(match[2] ?? match[1].replace(/\?/g, 'f'), 16);
    if (min > max || max > 0x10ffff) return;
    ranges.push([min, max]);
  }
  return ranges;
}

/** Unknown descriptors never establish disjointness. */
export function variantOverlap(a: Variant, b: Variant): Overlap {
  const weights = intersects(range(a.weight, { normal: '400', bold: '700' }),
    range(b.weight, { normal: '400', bold: '700' }));
  const stretches = { 'ultra-condensed': '50', 'extra-condensed': '62.5', condensed: '75',
    'semi-condensed': '87.5', normal: '100', 'semi-expanded': '112.5', expanded: '125',
    'extra-expanded': '150', 'ultra-expanded': '200' };
  const stretch = intersects(range(a.stretch, stretches), range(b.stretch, stretches));
  const sa = a.style?.toLowerCase().trim();
  const sb = b.style?.toLowerCase().trim();
  const simple = new Set(['normal', 'italic', 'oblique']);
  const style: Overlap = sa === undefined || sb === undefined ? 'unknown'
    : sa === sb ? 'yes' : simple.has(sa) && simple.has(sb) ? 'no' : 'unknown';
  const ua = unicode(a.unicodeRange), ub = unicode(b.unicodeRange);
  const characters: Overlap = ua && ub
    ? ua.some(x => ub.some(y => intersects(x, y) === 'yes')) ? 'yes' : 'no'
    : 'unknown';
  const results = [weights, stretch, style, characters];
  if (results.includes('no')) return 'no';
  if (results.includes('unknown') || (a.subset !== b.subset && (a.subset || b.subset))) return 'unknown';
  return 'yes';
}

export function variantsOverlap(a: readonly Variant[] | undefined, b: readonly Variant[] | undefined): Overlap {
  if (!a?.length || !b?.length) return 'unknown';
  const pairs = a.flatMap(x => b.map(y => variantOverlap(x, y)));
  return pairs.includes('yes') ? 'yes' : pairs.includes('unknown') ? 'unknown' : 'no';
}
