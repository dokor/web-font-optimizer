import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Language, SourceFile } from './contracts.js';

const ignored = new Set(['node_modules', '.next', 'dist', 'build', '.git']);
const languages = new Map<string, Language>([
  ['.html', 'html'], ['.css', 'css'], ['.scss', 'scss'], ['.js', 'js'],
  ['.jsx', 'jsx'], ['.ts', 'ts'], ['.tsx', 'tsx'],
]);

export type DiscoveredFile = Pick<SourceFile, 'file' | 'language'>;

export async function discoverSources(target = '.'): Promise<{
  root: string;
  files: DiscoveredFile[];
}> {
  const absolute = resolve(target);
  const stat = await lstat(absolute);
  const files: DiscoveredFile[] = [];
  function add(file: string) {
    const language = languages.get(extname(file).toLowerCase());
    if (language) files.push({ file, language });
  }

  if (stat.isFile()) {
    add(basename(absolute));
    if (!files.length) throw new Error(`Extension non prise en charge : ${target}`);
    return { root: dirname(absolute), files };
  }
  if (!stat.isDirectory()) throw new Error(`Fichier ou répertoire attendu : ${target}`);

  async function walk(relative: string): Promise<void> {
    const entries = await readdir(join(absolute, relative), { withFileTypes: true });
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !ignored.has(entry.name)) await walk(file);
      else if (entry.isFile()) add(file);
    }
  }
  if (!ignored.has(basename(absolute))) await walk('');
  files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  return { root: absolute, files };
}
