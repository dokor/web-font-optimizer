import type { AuditReportV1 } from '../contracts.js';
import { renderJson } from './json.js';
import { getExitCode } from './policy.js';
import { renderTerminal } from './terminal.js';

const usage = 'Usage : web-font-optimizer scan [chemin] [--report terminal|json] [--fail-on-duplicates]';
const help = `${usage}
Affiche l’inventaire et les diagnostics (répertoire courant par défaut).
  --report terminal|json  Choisir le format (terminal par défaut).
  --fail-on-duplicates   Échouer sur un diagnostic duplicate-load de confiance certain.
  --                     Terminer les options pour un chemin commençant par un tiret.
  -h, --help             Afficher cette aide.
Codes de sortie : 0 = audit accepté ; 1 = doublon certain avec l’option CI ;
2 = erreur d’invocation, d’accès au chemin ou d’exécution.`;

export interface CliDependencies {
  /** Call the audit pipeline once; both formats and the policy consume this same result. */
  readonly audit: (target: string) => AuditReportV1 | Promise<AuditReportV1>;
  /** Writers receive the complete text, including its trailing newline. */
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function invalidArguments(): never {
  throw new Error(`Arguments invalides. ${usage} (voir --help).`);
}

function parseArguments(args: readonly string[]) {
  const isHelp = (arg?: string) => arg === '-h' || arg === '--help';
  if (args.length === 1 && isHelp(args[0])) return { help: true } as const;
  if (args[0] !== 'scan') invalidArguments();
  let target: string | undefined;
  let format: 'terminal' | 'json' = 'terminal';
  let reportSeen = false;
  let failOnDuplicates = false;
  let helpRequested = false;
  let endOfOptions = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (!endOfOptions && arg === '--') {
      endOfOptions = true;
    } else if (!endOfOptions && isHelp(arg)) {
      helpRequested = true;
    } else if (!endOfOptions && (arg === '--report' || arg.startsWith('--report='))) {
      if (reportSeen) invalidArguments();
      const value = arg === '--report' ? args[++index] : arg.slice('--report='.length);
      if (value !== 'terminal' && value !== 'json') invalidArguments();
      format = value;
      reportSeen = true;
    } else if (!endOfOptions && arg === '--fail-on-duplicates') {
      failOnDuplicates = true;
    } else {
      if ((!endOfOptions && arg.startsWith('-')) || !arg || target !== undefined) invalidArguments();
      target = arg;
    }
  }
  return { help: helpRequested, target: target ?? '.', format, failOnDuplicates } as const;
}

/** No process globals or rule evaluation: suitable for isolated tests and pipeline integration. */
export async function runCli(args: readonly string[], dependencies: CliDependencies): Promise<0 | 1 | 2> {
  try {
    const options = parseArguments(args);
    if (options.help) {
      dependencies.stdout(`${help}\n`);
      return 0;
    }
    const report = await dependencies.audit(options.target);
    const output = options.format === 'json' ? renderJson(report) : renderTerminal(report);
    dependencies.stdout(output);
    return getExitCode(report, options);
  } catch (error: unknown) {
    dependencies.stderr(`web-font-optimizer : ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
