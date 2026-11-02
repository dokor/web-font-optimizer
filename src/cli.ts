#!/usr/bin/env node
import { scan } from './scan.js';

const usage = 'Usage : web-font-optimizer scan [chemin]';
const help = `${usage}
Découvre les fichiers sources du projet (répertoire courant par défaut).
  -h, --help    Afficher cette aide.`;

async function main(args: string[]): Promise<void> {
  const isHelp = (arg?: string) => arg === '-h' || arg === '--help';
  if ((args.length === 1 && isHelp(args[0])) ||
      (args.length === 2 && args[0] === 'scan' && isHelp(args[1]))) {
    console.log(help);
    return;
  }
  const [command, target] = args;
  if (command !== 'scan' || args.length > 2 || target?.startsWith('-') || target === '') {
    throw new Error(`Arguments invalides. ${usage} (voir --help).`);
  }
  const { files } = await scan(target);
  console.log(`Fichiers sources découverts : ${files.length}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`web-font-optimizer : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
