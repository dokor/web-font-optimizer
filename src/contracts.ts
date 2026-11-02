/** All public data is JSON-compatible. Files are relative to the scan root,
 * with "/" separators; lines and UTF-16 columns both start at 1. */
export interface Location {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export type Language = 'html' | 'css' | 'scss' | 'js' | 'jsx' | 'ts' | 'tsx';

export interface SourceFile {
  readonly file: string;
  readonly language: Language;
  readonly text: string;
}

/** Keep authored ranges and descriptors, e.g. weight "100 900". */
export interface Variant {
  readonly weight?: string;
  readonly style?: string;
  readonly stretch?: string;
  readonly unicodeRange?: string;
  readonly subset?: string;
}

export interface FontSource {
  readonly kind: 'file' | 'url' | 'local-name' | 'data';
  readonly value: string;
  readonly format?: string;
}

interface Evidence {
  readonly location: Location;
  /** Mechanism that produced the evidence, e.g. "@font-face" or "next/font/google". */
  readonly origin: string;
  readonly family?: string;
  readonly variants?: readonly Variant[];
  /** Scope or instance identity, when statically identifiable. */
  readonly context?: string;
}

export interface Declaration extends Evidence {
  readonly kind: 'declaration';
  /** Fallback order matters; retain relative paths and undecoded URLs. */
  readonly sources?: readonly FontSource[];
  readonly display?: string;
}

export interface Usage extends Evidence {
  readonly kind: 'usage';
  readonly familyStack?: readonly string[];
  /** Authored static CSS value, including shorthand. */
  readonly value?: string;
  /** A reference in source code; this is not evidence of browser rendering. */
  readonly cssModule?: {
    /** Scan-root-relative path, matching discovery; no import traversal. */
    readonly stylesheet: string;
    readonly className: string;
  };
}

export interface Resource extends Evidence {
  readonly kind: 'resource';
  readonly role: 'font' | 'stylesheet' | 'preload' | 'preconnect';
  readonly source: FontSource;
}

export interface VariableReference extends Evidence {
  readonly kind: 'variable';
  readonly action: 'define' | 'reference';
  readonly name: string;
  readonly value?: string;
}

export interface Indeterminate extends Evidence {
  readonly kind: 'indeterminate';
  readonly expression: string;
  readonly reason: string;
}

export type Observation = Declaration | Usage | Resource | VariableReference | Indeterminate;

export interface Analyzer {
  readonly id: string;
  readonly languages: readonly Language[];
  analyze(source: SourceFile): readonly Observation[] | Promise<readonly Observation[]>;
}

/** Machine identifiers are independent of wording and severity. */
export type RuleId = 'duplicate-load' | 'possible-overlap' | 'no-static-usage' | 'undeclared-family';

export interface Diagnostic {
  readonly ruleId: RuleId;
  readonly severity: 'info' | 'warning' | 'error';
  readonly confidence: 'possible' | 'probable' | 'certain';
  readonly message: string;
  readonly locations: readonly [Location, ...Location[]];
  readonly advice: string;
}

export interface AuditReportV1 {
  readonly version: 1;
  readonly inventory: {
    readonly observations: readonly Observation[];
    /** One entry per distinct resource. Omit sizeBytes when unknown. */
    readonly resources: readonly {
      readonly source: FontSource;
      readonly sizeBytes?: number;
      readonly locations: readonly Location[];
    }[];
  };
  readonly diagnostics: readonly Diagnostic[];
}
