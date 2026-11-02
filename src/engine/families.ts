import type { Observation, Usage, VariableReference } from '../contracts.js';

export function familyName(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').toLowerCase();
}

const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const systemFamilies = new Set(['-apple-system', 'blinkmacsystemfont', 'arial', 'helvetica',
  'helvetica neue', 'times new roman', 'courier new', 'courier', 'georgia', 'verdana', 'tahoma',
  'trebuchet ms', 'segoe ui', 'segoe ui emoji', 'segoe ui symbol', 'apple color emoji', 'noto color emoji']);

export function isSystemFamily(value: string): boolean {
  const quoted = /^['"]/.test(value.trim());
  return systemFamilies.has(familyName(value)) || (!quoted && genericFamilies.has(familyName(value)));
}

/** A global declaration can serve a scoped usage; an unidentified scope is ambiguous. */
export function canServe(declaration: Observation, usage: Observation): boolean {
  return declaration.scope === 'global' || declaration.context === undefined || usage.context === undefined || declaration.context === usage.context;
}

// Split a literal CSS family list without splitting var() fallbacks or quoted names.
function splitFamilies(value: string): string[] {
  const result: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (quote || depth !== 0) return [];
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

export interface ResolvedUsage {
  readonly observation: Usage | VariableReference;
  readonly families: readonly string[];
  readonly dynamic: boolean;
  /** Instance scopes proven by resolving a unique exposed variable definition. */
  readonly providers: readonly string[];
}

export function resolveUsages(observations: readonly Observation[]): ResolvedUsage[] {
  const definitions = observations.filter((o): o is VariableReference => o.kind === 'variable' && o.action === 'define');
  const exposed = new Set(observations.filter((o): o is VariableReference => o.kind === 'variable' && o.action === 'reference'
    && o.origin === 'next/font/variable').map(o => JSON.stringify([o.context, o.name])));
  function resolveValue(value: string, usage: Observation, seen: ReadonlySet<string>, providers: Set<string>): { families: string[]; dynamic: boolean } {
    const parts = splitFamilies(value);
    if (!parts.length) return { families: [], dynamic: true };
    let dynamic = false;
    const families: string[] = [];
    for (const part of parts) {
      const variable = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(part);
      if (variable?.[1]) {
        const name = variable[1];
        // Prefer definitions in the exact scope over global definitions.
        let candidates = definitions.filter(d => d.name === name && (d.scope === 'global' || d.context === undefined || d.context === usage.context));
        const exact = candidates.filter(d => usage.context !== undefined && d.context === usage.context);
        if (!exact.length) {
          const exported = definitions.filter(d => d.name === name && d.origin.startsWith('next/font/')
            && exposed.has(JSON.stringify([d.context, d.name])));
          if (exported.length) {
            // Competing CSS/Next bindings or multiple exposed instances have no known DOM precedence.
            candidates = !candidates.length && new Set(exported.map(d => d.context)).size === 1 ? exported : [];
          }
        }
        const scoped = candidates.filter(d => usage.context !== undefined && d.context === usage.context);
        const values = new Set((scoped.length ? scoped : candidates).map(d => d.value ?? d.family));
        const [resolved] = values;
        if (!seen.has(name) && values.size === 1 && resolved !== undefined) {
          for (const candidate of scoped.length ? scoped : candidates) {
            if (candidate.context !== undefined && candidate.origin.startsWith('next/font/')) providers.add(candidate.context);
          }
          const result = resolveValue(resolved, usage, new Set([...seen, name]), providers);
          families.push(...result.families); dynamic ||= result.dynamic;
        } else {
          // A fallback cannot establish the runtime value of an unresolved variable.
          dynamic = true;
        }
      } else if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(part) || /[()${}]/.test(part)) {
        dynamic = true;
      } else families.push(part);
    }
    return { families, dynamic };
  }
  return observations.flatMap(observation => {
    if (observation.kind !== 'usage' && !(observation.kind === 'variable' && observation.action === 'reference')) return [];
    if (observation.origin === 'next/font/variable') return []; // Exposure alone is not consumption.
    const values = observation.kind === 'usage'
      ? observation.familyStack?.length ? observation.familyStack : observation.family ? [observation.family] : []
      : [observation.family ?? observation.value ?? `var(${observation.name})`];
    const providers = new Set<string>();
    const resolved = values.map(value => resolveValue(value, observation, new Set(), providers));
    return [{ observation, families: [...new Set(resolved.flatMap(r => r.families))],
      dynamic: !values.length || resolved.some(r => r.dynamic), providers: [...providers] }];
  });
}
