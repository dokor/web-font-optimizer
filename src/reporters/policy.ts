import type { AuditReportV1 } from '../contracts.js';

export interface ReportOptions {
  readonly failOnDuplicates?: boolean;
}

/** 1 is a CI policy failure; invocation/access/execution errors use 2 in the CLI. */
export function getExitCode(report: AuditReportV1, options: ReportOptions = {}): 0 | 1 {
  return options.failOnDuplicates && report.diagnostics.some(diagnostic =>
    diagnostic.ruleId === 'duplicate-load' && diagnostic.confidence === 'certain',
  ) ? 1 : 0;
}
