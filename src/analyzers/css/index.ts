import postcss, { type ChildNode, type Declaration as CssDeclaration, type AtRule, type Rule, type Node } from 'postcss';
import { parse as parseScss } from 'postcss-scss';
import parser from 'postcss-value-parser';
import type { Analyzer, Observation, SourceFile, Variant } from '../../contracts.js';
import { aliases } from './aliases.js';
import { families, fontSources, shorthand, source, stringArgument, tokens, stringify } from './values.js';

export const cssAnalyzer: Analyzer = {
  id: 'css',
  languages: ['css', 'scss'],
  analyze(input) {
    if (input.language !== 'css' && input.language !== 'scss') return [];
    return analyzeStylesheet(input);
  },
};

function analyzeStylesheet(input: SourceFile): Observation[] {
  const observations: Observation[] = [];
  function location(offset: number) {
    const prefix = input.text.slice(0, offset);
    const last = prefix.lastIndexOf('\n');
    return { file: input.file, line: prefix.split('\n').length, column: offset - last };
  }
  let root;
  try {
    root = input.language === 'scss' ? parseScss(input.text) : postcss.parse(input.text);
  } catch (error) {
    const e = error as { line?: number; column?: number; reason?: string };
    return [{
      kind: 'indeterminate', origin: 'stylesheet',
      location: { file: input.file, line: e.line ?? 1, column: e.column ?? 1 },
      expression: input.text, reason: e.reason ?? 'Feuille non analysable.',
    }];
  }
  const resolve = aliases(root);
  function context(node: ChildNode): string {
    const parts: string[] = [];
    let parent: Node | undefined = node.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'rule') parts.unshift((parent as Rule).selector);
      else if (parent.type === 'atrule') parts.unshift('@' + (parent as AtRule).name + ' ' + (parent as AtRule).params);
      parent = parent.parent;
    }
    return parts.join(' > ') || ':stylesheet';
  }
  const evidence = (node: ChildNode, origin: string) => ({
    location: location(node.source?.start?.offset ?? 0), origin, context: context(node),
  });
  function unknown(node: ChildNode, expression: string, reason: string) {
    observations.push({ ...evidence(node, node.type === 'decl' ? node.prop : '@' + (node as AtRule).name),
      kind: 'indeterminate', expression, reason });
  }
  function dynamicScope(node: ChildNode): boolean {
    let parent: Node | undefined = node.parent;
    while (parent && parent.type !== 'root') {
      if ((parent.type === 'rule' && (parent as Rule).selector.includes('#{')) ||
          (parent.type === 'atrule' && /^(mixin|function|include|if|else|each|for|while)$/i.test((parent as AtRule).name))) return true;
      parent = parent.parent;
    }
    return false;
  }
  function valueOf(d: CssDeclaration): string | undefined {
    const result = resolve(d.value, d);
    if (dynamicScope(d) || result.reason) {
      unknown(d, d.value, result.reason ?? 'Portée SCSS dynamique ou non appliquée.');
      return;
    }
    return result.value;
  }
  const fontProps = new Set(['font', 'font-family', 'font-weight', 'font-style', 'font-stretch']);
  function variantValue(property: string, value: string): Variant | undefined {
    const valid = property === 'font-weight'
      ? /^(?:normal|bold|bolder|lighter|\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)?)$/i.test(value)
      : property === 'font-style'
        ? /^(?:normal|italic|oblique(?:\s+-?[\d.]+deg){0,2})$/i.test(value)
        : /^(?:normal|(?:(?:ultra-|extra-|semi-)?(?:condensed|expanded))|[\d.]+%(?:\s+[\d.]+%)?)$/i.test(value);
    if (!valid) return;
    return { [property.slice(5)]: value };
  }

  // Emit authored bindings/references independently from the resolved font evidence.
  root.walkDecls(d => {
    if (!fontProps.has(d.prop.toLowerCase()) && !/^(--|\$)/.test(d.prop) &&
        d.parent?.type !== 'atrule') return;
    if (/^(--|\$)/.test(d.prop)) observations.push({
      ...evidence(d, 'variable'), kind: 'variable', action: 'define', name: d.prop, value: d.value,
    });
    const offset = (d.source?.start?.offset ?? 0) + d.prop.length + (d.raws.between?.length ?? 1);
    parser(d.value).walk(node => {
      const name = node.type === 'function' && node.value.toLowerCase() === 'var'
        ? stringify(node.nodes).split(',')[0]!.trim()
        : node.type === 'word' && /^\$[\w-]+$/.test(node.value) ? node.value : undefined;
      if (name) observations.push({
        ...evidence(d, 'variable'), location: location(offset + node.sourceIndex),
        kind: 'variable', action: 'reference', name,
      });
    });
  });

  root.walkAtRules(at => {
    if (at.name.toLowerCase() === 'import') {
      const first = tokens(at.params)[0];
      const raw = first && stringArgument(first);
      if (!raw || /#\{|\$[\w-]+/.test(raw) || dynamicScope(at)) {
        unknown(at, at.params, 'Import non statique.');
      } else {
        const conditions = at.params.slice(first!.sourceEndIndex).trim();
        observations.push({
          ...evidence(at, '@import'),
          context: context(at) + (conditions ? ' > @import ' + conditions : ''),
          kind: 'resource', role: 'stylesheet', source: source(raw),
        });
      }
    }
    if (at.name.toLowerCase() !== 'font-face') return;
    const descriptors = new Map<string, CssDeclaration[]>();
    for (const child of at.nodes ?? []) {
      if (child.type !== 'decl') continue;
      const key = child.prop.toLowerCase();
      descriptors.set(key, [...(descriptors.get(key) ?? []), child]);
    }
    const get = (property: string) => {
      const list = descriptors.get(property);
      if (!list) return;
      if (list.length > 1) {
        for (const d of list) unknown(d, d.value, 'Descripteur surchargé.');
        return;
      }
      return valueOf(list[0]!);
    };
    const familyValue = get('font-family');
    const stack = familyValue && families(familyValue);
    if (familyValue && (!stack || stack.length !== 1)) {
      unknown(descriptors.get('font-family')![0]!, familyValue, 'Famille non statique.');
    }
    const variant: { weight?: string; style?: string; stretch?: string; unicodeRange?: string } = {};
    for (const prop of ['font-weight', 'font-style', 'font-stretch']) {
      const value = get(prop);
      if (!value) continue;
      const parsed = variantValue(prop, value);
      if (parsed) Object.assign(variant, parsed);
      else unknown(descriptors.get(prop)![0]!, value, 'Variante non statique.');
    }
    const unicode = get('unicode-range');
    if (unicode) variant.unicodeRange = unicode;
    const src = get('src');
    const parsed = src ? fontSources(src) : { sources: [], unknown: false };
    if (parsed.unknown) unknown(descriptors.get('src')![0]!, src!, 'Source de police non statique.');
    const display = get('font-display');
    const details = {
      ...(stack?.length === 1 ? { family: stack[0]! } : {}),
      ...(Object.keys(variant).length ? { variants: [variant] } : {}),
    };
    observations.push({
      ...evidence(at, '@font-face'), ...details, kind: 'declaration',
      sources: parsed.sources, ...(display ? { display } : {}),
    });
    for (const item of parsed.sources) {
      if (item.kind === 'local-name') continue;
      observations.push({
        ...evidence(descriptors.get('src')![0]!, '@font-face'), ...details,
        kind: 'resource', role: 'font', source: item,
      });
    }
  });

  root.walkDecls(d => {
    const prop = d.prop.toLowerCase();
    if (!fontProps.has(prop) || (d.parent?.type === 'atrule' && d.parent.name.toLowerCase() === 'font-face')) return;
    const value = valueOf(d);
    if (!value) return;
    const base = { ...evidence(d, prop), kind: 'usage' as const };
    if (prop === 'font' || prop === 'font-family') {
      const parsed = prop === 'font' ? shorthand(value) : undefined;
      const stack = prop === 'font-family' ? families(value) : parsed?.familyStack;
      if (!stack) { unknown(d, d.value, 'Famille ou raccourci non statique.'); return; }
      observations.push({
        ...base, family: stack[0]!, familyStack: stack,
        ...(parsed && Object.keys(parsed.variant).length ? { variants: [parsed.variant] } : {}),
      });
    } else {
      const variant = variantValue(prop, value);
      if (variant) observations.push({ ...base, variants: [variant] });
      else unknown(d, d.value, 'Variante non statique.');
    }
  });
  return observations;
}
