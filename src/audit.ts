import type { Analyzer, AuditReportV1 } from './contracts.js';
import { cssAnalyzer } from './analyzers/css/index.js';
import { htmlAnalyzer } from './analyzers/html/index.js';
import { reactAnalyzer } from './analyzers/react/index.js';
import { nextAnalyzer } from './analyzers/next/index.js';
import { buildAuditReport } from './engine/index.js';
import { scan } from './scan.js';

export const productionAnalyzers: readonly Analyzer[] = Object.freeze([
  cssAnalyzer, htmlAnalyzer, reactAnalyzer, nextAnalyzer,
]);

/** The same read-only production pipeline used by the installed CLI. */
export async function audit(target = '.'): Promise<AuditReportV1> {
  const { root, observations } = await scan(target, productionAnalyzers);
  return buildAuditReport(observations, { root });
}
