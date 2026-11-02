import { posix } from 'node:path';
import type { AuditReportV1, Declaration, Diagnostic, FontSource, Observation, Resource, Variant } from '../contracts.js';
import { canServe, familyName, isSystemFamily, resolveUsages } from './families.js';
import { inventoryResources } from './resources.js';
import { canonical, compare, key, locations } from './stable.js';
import { variantsOverlap } from './variants.js';

export interface AuditOptions {
  /** Scan root. Local file sources resolve relative to the observation's file. */
  readonly root?: string;
}

type Load = Declaration | Resource;

function isLoad(o: Observation): o is Load {
  return o.kind === 'declaration' || (o.kind === 'resource' && (o.role === 'stylesheet' || o.role === 'font'));
}

function sourceIdentity(load: Load, source: FontSource): FontSource {
  return source.kind === 'file'
    ? { ...source, value: posix.normalize(posix.join(posix.dirname(load.location.file), source.value)) } : source;
}

function loadSignature(load: Load): string | undefined {
  if (load.kind === 'declaration' && !load.sources?.length && !load.origin.startsWith('next/font/')) return;
  const { location, context, ...evidence } = load;
  const normalized = load.kind === 'resource' ? { source: sourceIdentity(load, load.source) }
    : { sources: load.sources?.map(source => sourceIdentity(load, source)) };
  return key({ ...evidence, ...normalized,
    variants: load.variants ? [...load.variants].sort((a, b) => compare(key(a), key(b))) : undefined,
    // Without a known instance/scope, only repeats in the same file are strict.
    context: context ?? { file: location.file } });
}

function sameSource(a: Load, b: Load): boolean {
  const sources = (load: Load) => load.kind === 'resource' ? [load.source] : load.sources ?? [];
  return sources(a).some(x => sources(b).some(y => key(sourceIdentity(a, x)) === key(sourceIdentity(b, y))));
}

function describeVariant(variant: Variant): string {
  return Object.entries(variant).map(([name, value]) => `${name}=${value}`).join(', ');
}

/** Reconcile synthetic or analyzer-produced evidence. No project execution or network I/O. */
export async function buildAuditReport(input: readonly Observation[], options: AuditOptions = {}): Promise<AuditReportV1> {
  const observations = input.map(canonical).sort((a, b) => compare(key(a), key(b)));
  const diagnostics: Diagnostic[] = [];
  const loads = observations.filter(isLoad);
  const repeats = new Map<string, Load[]>();
  for (const load of loads) {
    const signature = loadSignature(load);
    if (signature !== undefined) repeats.set(signature, [...repeats.get(signature) ?? [], load]);
  }
  for (const group of repeats.values()) {
    const involved = locations(group);
    if (involved.length < 2) continue; // Multiple analyzers may report the same occurrence.
    diagnostics.push({ ruleId: 'duplicate-load', severity: 'warning', confidence: 'certain', locations: involved,
      message: `Chargement identique répété dans un même contexte (${group[0]!.origin}).`,
      advice: 'Vérifier les emplacements puis conserver une seule déclaration ou un seul import dans ce contexte.' });
  }
  for (let i = 0; i < loads.length; i++) {
    const a = loads[i]!;
    for (const b of loads.slice(i + 1)) {
      if (key(a.location) === key(b.location)) continue;
      const signature = loadSignature(a);
      if (signature !== undefined && signature === loadSignature(b)) continue;
      const sameFamily = a.family && b.family && familyName(a.family) === familyName(b.family);
      // Separate files, subsets and fallback formats are not duplicates by family alone.
      if (!(sameFamily && a.origin !== b.origin) && !sameSource(a, b)) continue;
      const overlap = variantsOverlap(a.variants, b.variants);
      if (overlap === 'no') continue;
      diagnostics.push({ ruleId: 'possible-overlap', severity: 'info',
        confidence: overlap === 'yes' && a.context !== undefined && a.context === b.context ? 'probable' : 'possible',
        locations: locations([a, b]),
        message: `Chargements potentiellement concurrents${sameFamily ? ` pour ${a.family}` : ''} : ${a.origin} et ${b.origin}.`,
        advice: 'Vérifier les portées, les variantes et les requêtes réseau avant de choisir un seul mécanisme de chargement.' });
    }
  }

  const declarations = loads.filter(o => Boolean(o.family));
  const usages = resolveUsages(observations);
  for (const declaration of declarations) {
    const family = familyName(declaration.family!);
    const relevant = usages.filter(u => canServe(declaration, u.observation));
    const dynamic = relevant.some(u => u.dynamic) || observations.some(o => o.kind === 'indeterminate'
      && canServe(declaration, o) && (!o.family || familyName(o.family) === family));
    if (dynamic) continue;
    const matching = relevant.filter(u => u.families.some(f => familyName(f) === family));
    const candidates: (Variant | undefined)[] = declaration.variants?.length ? [...declaration.variants] : [undefined];
    for (const variant of candidates) {
      if (matching.some(u => variantsOverlap(variant ? [variant] : undefined, u.observation.variants) !== 'no')) continue;
      diagnostics.push({ ruleId: 'no-static-usage', severity: 'info', confidence: 'possible', locations: [declaration.location],
        message: `Aucun usage statique repéré pour ${declaration.family}${variant ? ` (${describeVariant(variant)})` : ''}.`,
        advice: 'Vérifier les usages dynamiques, les portées, les pages non analysées et les feuilles externes avant toute suppression.' });
    }
  }
  for (const usage of usages) {
    // A partially dynamic stack cannot prove an undeclared family at runtime.
    if (usage.dynamic) continue;
    for (const family of usage.families) {
      if (isSystemFamily(family)) continue;
      const known = declarations.filter(d => familyName(d.family!) === familyName(family) && canServe(d, usage.observation));
      if (known.length) continue;
      diagnostics.push({ ruleId: 'undeclared-family', severity: 'info', confidence: 'possible', locations: [usage.observation.location],
        message: `Aucune déclaration connue dans cette portée pour ${family}.`,
        advice: 'Vérifier les feuilles externes, les polices installées et la portée des déclarations avant d’ajouter un chargement.' });
    }
  }

  const unique = new Map(diagnostics.map(d => [key(d), d]));
  return canonical({ version: 1, inventory: { observations,
    resources: await inventoryResources(observations, options.root ?? '.') },
  diagnostics: [...unique.entries()].sort(([a], [b]) => compare(a, b)).map(([, d]) => d) });
}
