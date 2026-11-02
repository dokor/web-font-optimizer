import type { Location, Variant } from '../contracts.js';

export interface GoogleFontsFamily {
  readonly family: string;
  readonly variants: readonly Variant[];
}

export interface GoogleFontsIssue {
  readonly expression: string;
  readonly reason: string;
}

export interface GoogleFontsRequest {
  /** The URL exactly as supplied by the caller, before URL normalization. */
  readonly url: string;
  readonly location: Location;
  readonly api: 'css' | 'css2';
  readonly families: readonly GoogleFontsFamily[];
  readonly display?: string;
  readonly complete: boolean;
  readonly issues: readonly GoogleFontsIssue[];
}

/** Decode an extracted, unescaped URL. HTML entities and CSS escapes belong to
 * the caller's syntax parser. Never fetches a stylesheet or a font. */
export function decodeGoogleFontsUrl(url: string, location: Location): GoogleFontsRequest | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim().startsWith('//') ? `https:${url.trim()}` : url);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'fonts.googleapis.com' ||
      parsed.username || parsed.password || !['/css', '/css2'].includes(parsed.pathname)) return undefined;

  const api = parsed.pathname === '/css2' ? 'css2' : 'css';
  const issues: GoogleFontsIssue[] = [];
  const families: GoogleFontsFamily[] = [];
  const issue = (expression: string, reason: string) => { issues.push({ expression, reason }); };
  if (/%(?![\da-f]{2})/i.test(parsed.search) || parsed.searchParams.toString().includes('%EF%BF%BD')) {
    issue(url, 'Encodage URL invalide ou incomplet.');
  }
  const specs = parsed.searchParams.getAll('family');
  if (!specs.length) issue(url, 'Paramètre family absent.');

  for (const spec of specs.flatMap(value => api === 'css' ? value.split('|') : [value])) {
    const colon = spec.indexOf(':');
    const family = (colon < 0 ? spec : spec.slice(0, colon)).trim();
    if (!family || /[${}<>|@;\uFFFD]/u.test(family)) {
      issue(spec, 'Nom de famille absent ou non résolu.');
      continue;
    }
    const styles = colon < 0 ? undefined : spec.slice(colon + 1);
    const variants: Variant[] = [];
    if (styles === undefined) {
      variants.push({ weight: '400', style: 'normal' });
    } else if (api === 'css') {
      for (const style of styles.split(',')) {
        const token = style.trim().toLowerCase();
        const aliases: Record<string, Variant> = {
          regular: { weight: '400', style: 'normal' },
          normal: { weight: '400', style: 'normal' },
          italic: { weight: '400', style: 'italic' },
          i: { weight: '400', style: 'italic' },
          bold: { weight: '700', style: 'normal' },
          b: { weight: '700', style: 'normal' },
          bolditalic: { weight: '700', style: 'italic' },
          bi: { weight: '700', style: 'italic' },
        };
        const numeric = /^(\d{3})(italic|i)?$/.exec(token);
        if (Object.hasOwn(aliases, token)) variants.push(aliases[token]!);
        else if (numeric && Number(numeric[1]) >= 100 && Number(numeric[1]) <= 900) {
          variants.push({ weight: numeric[1]!, style: numeric[2] ? 'italic' : 'normal' });
        } else issue(style, 'Variante Google Fonts CSS non comprise.');
      }
    } else {
      const match = /^([^@]+)@([^@]+)$/.exec(styles);
      if (!match) issue(styles, 'Axes ou variantes Google Fonts CSS2 non compris.');
      else {
        const axes = match[1]!.split(',');
        if (new Set(axes).size !== axes.length || axes.some(axis => !/^[a-zA-Z]{4}$/.test(axis))) {
          issue(styles, 'Liste d’axes Google Fonts CSS2 invalide.');
        } else {
          for (const axis of axes) {
            if (!['wght', 'ital', 'wdth'].includes(axis)) issue(axis, 'Axe CSS2 non représenté dans les variantes.');
          }
          for (const tuple of match[2]!.split(';')) {
            const values = tuple.split(',');
            if (values.length !== axes.length) {
              issue(tuple, 'Nombre de valeurs différent du nombre d’axes CSS2.');
              continue;
            }
            const variant: { weight?: string; style?: string; stretch?: string } = {};
            let valid = true;
            for (let index = 0; index < axes.length; index++) {
              const axis = axes[index]!;
              const value = values[index]!;
              const range = numericRange(value);
              if (!range) {
                issue(tuple, 'Valeur ou intervalle CSS2 invalide.');
                valid = false;
                break;
              }
              if (axis === 'wght') {
                if (range.some(n => n < 1 || n > 1000)) {
                  issue(value, 'Graisse CSS2 hors intervalle.');
                  valid = false;
                } else variant.weight = value.replace('..', ' ');
              } else if (axis === 'ital') {
                if (value === '0' || value === '1') variant.style = value === '1' ? 'italic' : 'normal';
                else {
                  issue(value, 'Valeur ital CSS2 non comprise.');
                  valid = false;
                }
              } else if (axis === 'wdth') {
                if (range.some(n => n <= 0)) {
                  issue(value, 'Largeur CSS2 invalide.');
                  valid = false;
                } else variant.stretch = value.split('..').map(n => `${n}%`).join(' ');
              }
            }
            if (valid) {
              // Defaults are known only when the corresponding axis was omitted.
              if (!axes.includes('wght')) variant.weight = '400';
              if (!axes.includes('ital') && !axes.includes('slnt')) variant.style = 'normal';
              if (Object.keys(variant).length) variants.push(variant);
            }
          }
        }
      }
    }
    const subsets = parsed.searchParams.get('subset');
    families.push({ family, variants: subsets ? variants.map(variant => ({ ...variant, subset: subsets })) : variants });
  }
  const display = parsed.searchParams.get('display');
  return {
    url, location, api, families, ...(display ? { display } : {}),
    complete: issues.length === 0, issues,
  };
}

function numericRange(value: string): number[] | undefined {
  if (!/^-?\d+(?:\.\d+)?(?:\.\.-?\d+(?:\.\d+)?)?$/.test(value)) return undefined;
  const bounds = value.split('..').map(Number);
  if (bounds.some(n => !Number.isFinite(n)) || (bounds.length === 2 && bounds[0]! > bounds[1]!)) return undefined;
  return bounds;
}
