import type { Location } from '../contracts.js';

/** Sort object keys, but retain authored array order (notably source fallbacks). */
export function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compare(a, b)).map(([k, v]) => [k, canonical(v)])) as T;
  }
  return value;
}

export const key = (value: unknown): string => JSON.stringify(canonical(value));
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function locations(items: readonly { readonly location: Location }[]): [Location, ...Location[]] {
  const unique = new Map(items.map(item => [key(item.location), item.location]));
  const result = [...unique.values()].sort((a, b) => compare(a.file, b.file)
    || a.line - b.line || a.column - b.column);
  if (!result.length) throw new Error('Un diagnostic doit avoir un emplacement.');
  return result as [Location, ...Location[]];
}
