import valueParser from 'postcss-value-parser';
import type { Location, Observation, Variant } from '../../contracts.js';

export const fontProperties = new Set(['fontFamily', 'fontWeight', 'fontStyle', 'font']);
const cssWide = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
type Node = valueParser.Node;
const meaningful = (nodes: Node[]) => nodes.filter(n => n.type !== 'space' && n.type !== 'comment');

function families(nodes: Node[]): string[] | undefined {
  const result: string[] = [];
  let parts: string[] = [];
  for (const node of meaningful(nodes)) {
    if (node.type === 'div' && node.value === ',') {
      if (!parts.length) return;
      result.push(parts.join(' '));
      parts = [];
    } else if ((node.type === 'word' || node.type === 'string') && !('unclosed' in node && node.unclosed)) {
      parts.push(node.value);
    } else return;
  }
  if (!parts.length) return;
  result.push(parts.join(' '));
  return result;
}

function shorthand(nodes: Node[]): { familyStack: string[]; variants: Variant[] } | undefined {
  const tokens = meaningful(nodes);
  const sizeIndex = tokens.findIndex(n =>
    n.type === 'word' && /^(?:0|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|%)|(?:xx?-)?small|medium|(?:xx?-)?large|xxx-large|smaller|larger)$/i.test(n.value)
    || n.type === 'function' && /^(calc|min|max|clamp)$/i.test(n.value));
  if (sizeIndex < 0) return;
  let familyIndex = sizeIndex + 1;
  if (tokens[familyIndex]?.type === 'div' && tokens[familyIndex]?.value === '/') familyIndex += 2;
  const familyStack = families(tokens.slice(familyIndex));
  if (!familyStack) return;
  let weight: string | undefined;
  let style: string | undefined;
  for (let i = 0; i < sizeIndex; i++) {
    const node = tokens[i]!;
    if (node.type !== 'word') return;
    if (/^(bold|bolder|lighter|[1-9]\d{0,2}|1000)$/i.test(node.value)) weight = node.value;
    else if (/^(italic|oblique)$/i.test(node.value)) {
      style = node.value;
      const angle = tokens[i + 1];
      if (node.value.toLowerCase() === 'oblique' && angle?.type === 'word' && /^-?[\d.]+(?:deg|grad|rad|turn)$/.test(angle.value)) {
        style += ` ${angle.value}`;
        i++;
      }
    } else if (!/^(normal|small-caps|(?:ultra-|extra-|semi-)?(?:condensed|expanded))$/i.test(node.value)) return;
  }
  const variant = { ...(weight === undefined ? {} : { weight }), ...(style === undefined ? {} : { style }) };
  return { familyStack, variants: Object.keys(variant).length ? [variant] : [] };
}

/** Decode values only; CSS variables are recorded, never resolved or evaluated. */
export function fontValue(property: string, value: string, location: Location): Observation[] {
  const origin = `react:style:${property}`;
  const parsed = valueParser(value);
  const observations: Observation[] = [];
  let unresolved = false;
  parsed.walk(node => {
    if ('unclosed' in node && node.unclosed) unresolved = true;
    if (node.type !== 'function') return;
    if (node.value.toLowerCase() === 'var') {
      const name = meaningful(node.nodes)[0];
      if (name?.type === 'word' && name.value.startsWith('--')) {
        observations.push({ kind: 'variable', action: 'reference', name: name.value, value, origin, location });
      }
      unresolved = true;
    } else if (!/^(calc|min|max|clamp)$/i.test(node.value)) unresolved = true;
  });
  const usage = { kind: 'usage' as const, origin, location, value };
  function unknown(reason: string): Observation[] {
    return [...observations, { kind: 'indeterminate', origin, location, expression: value, reason }];
  }
  if (unresolved || cssWide.has(value.trim().toLowerCase())) {
    return unknown('La valeur CSS dépend de variables ou du contexte de rendu.');
  }
  if (property === 'fontFamily') {
    const familyStack = families(parsed.nodes);
    if (!familyStack) return unknown('Pile de familles CSS non résolue statiquement.');
    return [{ ...usage, family: familyStack[0]!, familyStack }];
  }
  if (property === 'fontWeight' || property === 'fontStyle') {
    return [{ ...usage, variants: [property === 'fontWeight' ? { weight: value } : { style: value }] }];
  }
  const result = shorthand(parsed.nodes);
  if (!result) return unknown('Raccourci font sans famille identifiable statiquement.');
  return [{ ...usage, family: result.familyStack[0]!, ...result }];
}
