import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Analyzer, Observation } from './contracts.js';
import { discoverSources, type DiscoveredFile } from './discovery.js';

export interface ScanResult {
  readonly root: string;
  readonly files: readonly DiscoveredFile[];
  readonly observations: readonly Observation[];
}

/** The registry is supplied by the caller; several analyzers may share a language. */
export async function scan(target = '.', analyzers: readonly Analyzer[] = []): Promise<ScanResult> {
  const { root, files } = await discoverSources(target);
  const observations: Observation[] = [];
  for (const file of files) {
    const matching = analyzers.filter(a => a.languages.includes(file.language));
    if (!matching.length) continue;
    const source = { ...file, text: await readFile(join(root, file.file), 'utf8') };
    for (const analyzer of matching) {
      try {
        for (const observation of await analyzer.analyze(source)) observations.push(observation);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`${analyzer.id} (${file.file}) : ${detail}`, { cause });
      }
    }
  }
  return { root, files, observations };
}
