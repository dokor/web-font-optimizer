import parser from 'postcss-value-parser';
import type { FontSource, Variant } from '../../contracts.js';

export const significant = (nodes: parser.Node[]) =>
  nodes.filter(n => n.type !== 'space' && n.type !== 'comment');
export const stringify = parser.stringify;
export const tokens = (value: string) => significant(parser(value).nodes);

export function groups(nodes: parser.Node[]): parser.Node[][] {
  const result: parser.Node[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') result.push([]);
    else result[result.length - 1]!.push(node);
  }
  return result;
}

function unescape(value: string): string {
  return value.replace(/\\([\da-f]{1,6}\s?|.)/gi, (_, escape: string) => {
    const hex = escape.trim();
    return /^[\da-f]{1,6}$/i.test(hex)
      ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff))
      : escape;
  });
}

export function families(value: string): string[] | undefined {
  const result: string[] = [];
  for (const group of groups(parser(value).nodes)) {
    const nodes = significant(group);
    if (!nodes.length || nodes.some(n => !['word', 'string'].includes(n.type))) return;
    if (nodes.some(n => /[$#]/.test(n.value))) return;
    if (nodes.some(n => n.type === 'string') && nodes.length !== 1) return;
    const name = unescape(nodes.map(n => n.value).join(' '));
    if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(name)) return;
    result.push(name);
  }
  return result.length ? result : undefined;
}

export function source(value: string, kind?: 'local-name'): FontSource {
  return {
    kind: kind ?? (/^data:/i.test(value) ? 'data'
      : /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) ? 'url' : 'file'),
    value,
  };
}

export function stringArgument(node: parser.Node): string | undefined {
  if (node.type === 'string') return node.value;
  if (node.type !== 'function') return;
  const inner = significant(node.nodes);
  if (inner.length === 1 && inner[0]!.type === 'string') return inner[0]!.value;
  if (inner.some(n => n.type === 'function' || n.type === 'string')) return;
  const value = stringify(node.nodes).trim();
  if (value && !/[$#]/.test(value)) return value;
}

export function fontSources(value: string): { sources: FontSource[]; unknown: boolean } {
  const sources: FontSource[] = [];
  let unknown = false;
  for (const group of groups(parser(value).nodes)) {
    const nodes = significant(group);
    const first = nodes[0];
    if (first?.type !== 'function' || !/^(url|local)$/i.test(first.value)) {
      unknown = true;
      continue;
    }
    const value = stringArgument(first);
    if (value === undefined || /#\{|\$[\w-]+/.test(value)) { unknown = true; continue; }
    const item = source(value, first.value.toLowerCase() === 'local' ? 'local-name' : undefined);
    const format = nodes.find(n => n.type === 'function' && n.value.toLowerCase() === 'format');
    const name = format && stringArgument(format);
    sources.push(name ? { ...item, format: name } : item);
  }
  return { sources, unknown };
}

/** Parse the explicit shorthand subset; unknown/system fonts remain indeterminate. */
export function shorthand(value: string): { familyStack: string[]; variant: Variant } | undefined {
  const nodes = tokens(value);
  const size = nodes.findIndex(n => n.type === 'word' &&
    /^(?:0|[\d.]+(?:px|pt|pc|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vmin|vmax|cm|mm|in|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i.test(n.value));
  if (size < 0) return;
  const variant: { weight?: string; style?: string; stretch?: string } = {};
  for (const node of nodes.slice(0, size)) {
    if (node.type !== 'word') return;
    const word = node.value.toLowerCase();
    if (word === 'normal' || word === 'small-caps') continue;
    if (/^(italic|oblique)$/.test(word)) variant.style = word;
    else if (word.endsWith('deg') && variant.style === 'oblique') variant.style += ' ' + word;
    else if (/^(bold|bolder|lighter|\d+(?:\.\d+)?)$/.test(word)) variant.weight = word;
    else if (/^(?:(?:ultra-|extra-|semi-)?(?:condensed|expanded))$/.test(word)) variant.stretch = word;
    else return;
  }
  let start = size + 1;
  if (nodes[start]?.type === 'div' && nodes[start]!.value === '/') start += 2;
  const familyStack = nodes[start] && families(value.slice(nodes[start]!.sourceIndex));
  if (familyStack) return { familyStack, variant };
}
