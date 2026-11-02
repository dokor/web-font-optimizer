import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { Analyzer, FontSource, Location, Observation, SourceFile } from '../../contracts.js';
import { decodeGoogleFontsUrl } from '../../sources/google-fonts.js';

/** Static link evidence only: a load never proves a font-family usage. */
export const htmlAnalyzer: Analyzer = {
  id: 'html',
  languages: ['html'],
  analyze: analyzeHtml,
};

export function analyzeHtml({ file, text }: SourceFile): readonly Observation[] {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const observations: Observation[] = [];
  const lineStarts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) lineStarts.push(match.index + match[0].length);
  function locationAt(offset: number): Location {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { file, line: low + 1, column: offset - lineStarts[low]! + 1 };
  }

  function visit(node: DefaultTreeAdapterTypes.Node): void {
    if ('tagName' in node && node.tagName === 'link' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      const attributes = new Map(node.attrs.map(attribute => [attribute.name, attribute.value]));
      const href = attributes.get('href');
      const hrefLocation = node.sourceCodeLocation?.attrs?.href;
      if (href?.trim() && hrefLocation) {
        const authored = text.slice(hrefLocation.startOffset, hrefLocation.endOffset);
        const prefix = /^[^\s=]+\s*=\s*/.exec(authored)?.[0];
        if (prefix) {
          const quote = authored[prefix.length];
          const quoted = quote === '"' || quote === "'";
          const start = prefix.length + (quoted ? 1 : 0);
          const originalUrl = authored.slice(start, quoted ? -1 : undefined);
          const location = locationAt(hrefLocation.startOffset + start);
          const source = fontSource(originalUrl, href);
          const rel = new Set((attributes.get('rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/));
          const roles = [
            ...(rel.has('stylesheet') ? ['stylesheet' as const] : []),
            ...(rel.has('preload') && attributes.get('as')?.toLowerCase() === 'font' ? ['preload' as const] : []),
            ...(rel.has('preconnect') ? ['preconnect' as const] : []),
          ];
          for (const role of roles) {
            const origin = `link[rel=${role}]`;
            const decoded = role === 'stylesheet' ? decodeGoogleFontsUrl(href, location) : undefined;
            observations.push({ kind: 'resource', origin, role, source, location,
              ...(decoded?.families.length ? { declarationLocation: location } : {}) });
            if (!decoded) continue;
            for (const { family, variants } of decoded.families) {
              observations.push({
                kind: 'declaration', origin, family, location, sources: [source],
                ...(variants.length ? { variants } : {}),
                ...(decoded.display ? { display: decoded.display } : {}),
              });
            }
            for (const { expression, reason } of decoded.issues) {
              observations.push({ kind: 'indeterminate', origin, expression, reason, location });
            }
          }
        }
      }
    }
    // Template contents are inert and are not part of childNodes in parse5.
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  }
  visit(document);
  // Tree construction can move HTML nodes; keep the authored order of links.
  return observations.sort((a, b) => a.location.line - b.location.line || a.location.column - b.location.column);
}

function fontSource(original: string, decoded: string): FontSource {
  const url = decoded.trim();
  const kind = /^data:/i.test(url) ? 'data' : /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) ? 'url' : 'file';
  return { kind, value: original };
}
