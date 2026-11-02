import type { AuditReportV1 } from '../contracts.js';

/** Serialize the engine's versioned report without adding presentation or policy fields. */
export function renderJson(report: AuditReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
