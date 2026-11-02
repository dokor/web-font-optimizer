export type * from './contracts.js';
export { discoverSources, type DiscoveredFile } from './discovery.js';
export { scan, type ScanResult } from './scan.js';
export { audit, productionAnalyzers } from './audit.js';
export { htmlAnalyzer, analyzeHtml } from './analyzers/html/index.js';
export {
  decodeGoogleFontsUrl,
  type GoogleFontsFamily,
  type GoogleFontsIssue,
  type GoogleFontsRequest,
} from './sources/google-fonts.js';

export { reactAnalyzer } from './analyzers/react/index.js';

export { buildAuditReport, type AuditOptions } from './engine/index.js';
