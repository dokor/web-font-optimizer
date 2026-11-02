import type { Node, Declaration, Root } from 'postcss';
import parser from 'postcss-value-parser';
import { groups, significant, stringify } from './values.js';

export interface Resolution { value: string; reason?: string }

/** Conservative lexical scopes: a single local binding, or an unconditional
 * :root CSS binding. Competing selector bindings cannot be decided statically. */
export function aliases(root: Root) {
  const definitions: Declaration[] = [];
  root.walkDecls(d => { if (/^(--|\$)/.test(d.prop)) definitions.push(d); });

  function conditionalAssignment(d: Declaration): boolean {
    if (/!global\b/.test(d.value)) return true;
    let parent: Node | undefined = d.parent;
    while (parent) {
      if (parent.type === 'atrule' && 'name' in parent &&
        /^(if|else|each|for|while)$/.test(String(parent.name))) return true;
      parent = parent.parent;
    }
    return false;
  }

  function lookup(name: string, at: Declaration): Declaration | undefined {
    if (name.startsWith('$') && definitions.some(d => d.prop === name &&
      conditionalAssignment(d))) return;
    let parent: Node | undefined = at.parent;
    while (parent) {
      const local = definitions.filter(d => d.prop === name && d.parent === parent);
      if (local.length) {
        if (name.startsWith('--') && definitions.some(d => d.prop === name &&
          d.parent !== parent && !(d.parent?.type === 'rule' &&
          d.parent.selector.trim() === ':root' && d.parent.parent?.type === 'root'))) return;
        return local.length === 1 ? local[0] : undefined;
      }
      parent = parent.parent;
    }
    if (name.startsWith('--')) {
      const candidates = definitions.filter(d => d.prop === name);
      if (candidates.length === 1) {
        const d = candidates[0]!;
        if (d.parent?.type === 'rule' && d.parent.selector.trim() === ':root' &&
            d.parent.parent?.type === 'root') return d;
      }
    }
    return;
  }

  function resolve(value: string, at: Declaration, seen = new Set<Declaration>()): Resolution {
    if (/#\{|![\w-]+/.test(value)) return { value, reason: 'Interpolation ou modificateur SCSS non résolu.' };
    let reason: string | undefined;
    const binding = (name: string, fallback?: string): string => {
      const definition = lookup(name, at);
      // A fallback is safe only if there is no competing binding in this file.
      if (!definition) {
        if (fallback !== undefined && !definitions.some(d => d.prop === name)) {
          const result = resolve(fallback, at, seen);
          reason ??= result.reason;
          return result.value;
        }
        reason ??= `Alias absent ou surchargé : ${name}.`;
        return name;
      }
      if (seen.has(definition)) { reason ??= `Cycle d’alias : ${name}.`; return name; }
      // Sass variables capture values at their assignment point.
      if (name.startsWith('$') && (definition.source?.start?.offset ?? 0) >= (at.source?.start?.offset ?? 0)) {
        reason ??= `Alias SCSS déclaré après son usage : ${name}.`;
        return name;
      }
      const result = resolve(definition.value, definition, new Set([...seen, definition]));
      reason ??= result.reason;
      return result.value;
    };
    function replace(nodes: parser.Node[]): string {
      return nodes.map(node => {
        if (node.type === 'function') {
          if (node.value.toLowerCase() === 'var') {
            const parts = groups(node.nodes);
            const name = stringify(significant(parts[0]!)).trim();
            const fallback = parts.length > 1 ? parts.slice(1).map(part => stringify(part)).join(',') : undefined;
            return binding(name, fallback);
          }
          return node.value + '(' + replace(node.nodes) + ')';
        }
        if (node.type === 'word') {
          return node.value.replace(/\$[\w-]+/g, name => binding(name));
        }
        return stringify(node);
      }).join('');
    }
    const resolved = replace(parser(value).nodes);
    return reason ? { value: resolved, reason } : { value: resolved };
  }
  return resolve;
}
