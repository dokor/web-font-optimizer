import type { AuditReportV1, FontSource, Location, Observation, Variant } from '../contracts.js';

const kinds: Record<Observation['kind'], string> = {
  declaration: 'Déclaration', usage: 'Usage', resource: 'Ressource',
  variable: 'Variable', indeterminate: 'Indéterminé',
};
const severities = { info: 'information', warning: 'avertissement', error: 'erreur' };
const confidences = { possible: 'possible', probable: 'probable', certain: 'certaine' };
const descriptors: ReadonlyArray<readonly [keyof Variant, string]> = [
  ['weight', 'graisse'], ['style', 'style'], ['stretch', 'chasse'],
  ['unicodeRange', 'unicode-range'], ['subset', 'sous-ensemble'],
];

// Keep source text on one line and prevent authored control sequences from coloring the terminal.
function inline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, character => {
    const escaped = JSON.stringify(character).slice(1, -1);
    return escaped === character ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}` : escaped;
  });
}

function locationText(location: Location): string {
  return `${inline(location.file)}:${location.line}:${location.column}`;
}

function locationKey(location: Location): string {
  return JSON.stringify([location.file, location.line, location.column]);
}

function sourceText(source: FontSource): string {
  return `${source.kind} ${inline(JSON.stringify(source.value))}` +
    (source.format === undefined ? '' : ` (format : ${inline(source.format)})`);
}

function evidenceLines(observation: Observation): string[] {
  const lines: string[] = [];
  if (observation.family !== undefined) lines.push(`Famille : ${inline(observation.family)}`);
  if (observation.context !== undefined) lines.push(`Contexte : ${inline(observation.context)}`);
  if (observation.variants?.length) {
    for (const variant of observation.variants) {
      const values = descriptors.flatMap(([key, label]) =>
        variant[key] === undefined ? [] : [`${label} ${inline(variant[key])}`],
      );
      lines.push(`Variante : ${values.join(', ') || 'descripteurs inconnus'}`);
    }
  } else {
    lines.push('Variantes : non précisées');
  }
  return lines;
}

/** Presentation only: evidence is linked by its contract location, never reclassified. */
export function renderTerminal(report: AuditReportV1): string {
  const { observations, resources } = report.inventory;
  const lines = [
    `Audit des polices — rapport v${report.version}`,
    `Inventaire : ${observations.length} observation(s), ${resources.length} ressource(s) distincte(s)`,
  ];
  const evidence = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = locationKey(observation.location);
    const matches = evidence.get(key) ?? [];
    matches.push(observation);
    evidence.set(key, matches);
    lines.push(`  ${kinds[observation.kind]} (${inline(observation.origin)}) — ${locationText(observation.location)}`);
    lines.push(...evidenceLines(observation).map(line => `    ${line}`));
    switch (observation.kind) {
      case 'declaration':
        if (observation.display !== undefined) lines.push(`    Affichage : ${inline(observation.display)}`);
        if (observation.sources?.length) {
          lines.push('    Sources (ordre de repli) :');
          lines.push(...observation.sources.map(source => `      ${sourceText(source)}`));
        }
        break;
      case 'usage':
        if (observation.familyStack?.length) {
          lines.push(`    Pile : ${observation.familyStack.map(family => inline(JSON.stringify(family))).join(' → ')}`);
        }
        break;
      case 'resource':
        lines.push(`    Rôle : ${observation.role} ; source : ${sourceText(observation.source)}`);
        break;
      case 'variable':
        lines.push(`    Variable (${observation.action}) : ${inline(observation.name)}` +
          (observation.value === undefined ? '' : ` = ${inline(observation.value)}`));
        break;
      case 'indeterminate':
        lines.push(`    Expression : ${inline(observation.expression)}`, `    Raison : ${inline(observation.reason)}`);
        break;
    }
  }
  if (!observations.length) lines.push('  Aucune observation.');
  lines.push('', 'Ressources distinctes :');
  for (const resource of resources) {
    lines.push(`  ${sourceText(resource.source)} — ` +
      (resource.sizeBytes === undefined ? 'taille inconnue' : `${resource.sizeBytes} octet(s)`));
    lines.push(...resource.locations.map(location => `    ${locationText(location)}`));
  }
  if (!resources.length) lines.push('  Aucune ressource.');
  if (resources.some(resource => resource.sizeBytes !== undefined)) {
    lines.push('  Les tailles sur disque ne mesurent pas une économie réseau.');
  }
  lines.push('', `Diagnostics : ${report.diagnostics.length}`);
  for (const diagnostic of report.diagnostics) {
    lines.push(`  [${severities[diagnostic.severity]} ; certitude ${confidences[diagnostic.confidence]}] ${diagnostic.ruleId}`);
    lines.push(`    ${inline(diagnostic.message)}`);
    for (const location of diagnostic.locations) {
      lines.push(`    ${locationText(location)}`);
      for (const observation of evidence.get(locationKey(location)) ?? []) {
        lines.push(`      Origine : ${inline(observation.origin)}`);
        lines.push(...evidenceLines(observation).map(line => `      ${line}`));
      }
    }
    lines.push(`    Action : ${inline(diagnostic.advice)}`);
  }
  if (!report.diagnostics.length) lines.push('  Aucun diagnostic.');
  return `${lines.join('\n')}\n`;
}
