import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { AuditReportV1, FontSource, Observation } from '../contracts.js';
import { compare, key, locations } from './stable.js';

type Entry = AuditReportV1['inventory']['resources'][number];

/** Inspect metadata only; never fetch URLs or interpret them as local paths. */
export async function inventoryResources(observations: readonly Observation[], root: string): Promise<Entry[]> {
  const groups = new Map<string, { source: FontSource; sizeBytes?: number; evidence: Observation[] }>();
  let realRoot: string | undefined;
  try { realRoot = await realpath(root); } catch { /* An inaccessible root leaves sizes unknown. */ }
  for (const observation of observations) {
    const sources = observation.kind === 'declaration' ? observation.sources ?? []
      : observation.kind === 'resource' ? [observation.source] : [];
    for (const source of sources) {
      let identity = key(source);
      let sizeBytes: number | undefined;
      if (source.kind === 'file') {
        const path = resolve(root, dirname(observation.location.file), source.value);
        identity = key({ kind: 'file', path });
        try {
          const actual = await realpath(path);
          const rel = realRoot === undefined ? '..' : relative(realRoot, actual);
          // Do not inspect files outside the scan root, including symlink escapes.
          if (realRoot !== undefined && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
            const info = await stat(actual);
            if (info.isFile()) {
              identity = key({ kind: 'file', path: actual });
              sizeBytes = info.size;
            }
          }
        } catch { /* Missing, denied or invalid resources do not abort the audit. */ }
      }
      const existing = groups.get(identity);
      if (existing) existing.evidence.push(observation);
      else groups.set(identity, { source, ...(sizeBytes === undefined ? {} : { sizeBytes }), evidence: [observation] });
    }
  }
  return [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, entry]) => ({
    source: entry.source,
    ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
    locations: locations(entry.evidence),
  }));
}
