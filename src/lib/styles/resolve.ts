import type { TextStyle } from '@tensor-editor/engine';
import type { StyleDefinition, StyleProperties, TextTransform } from './types';
import type { TextAlign } from '@/lib/paginated/positionMap';

/**
 * THE ONE RESOLUTION FUNCTION (M-STYLES STEP 3). Both render modes and
 * every UI surface (pageless stylesheet, Font/size dropdowns, style
 * dialog preview, capture-from-selection) resolve through here —
 * never parallel logic, never undefined-property guessing.
 *
 * PRECEDENCE (per property, weak → strong):
 *   baseStyle < paragraph style < paragraph attrs (direct block
 *   formatting) < char style < direct marks
 * Every tier only overrides with PRESENT values; the result is ALWAYS
 * a complete concrete style (the registry's contract: a render path
 * never guesses a missing property).
 */

export interface RunStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  lineHeight: number;
  fontVariant: 'small-caps' | 'normal';
  textTransform: TextTransform;
}

/** The complete baseline derived from the config baseStyle. */
export function baselineRunStyle(base: TextStyle): RunStyle {
  return {
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: '#000000',
    lineHeight: 1,
    fontVariant: 'normal',
    textTransform: 'none',
  };
}

export interface ResolveRunTiers {
  base: RunStyle;
  /** Paragraph-style definition (registry lookup — null = missing id,
   * the loud-fallback path). */
  para?: StyleDefinition | null;
  /** Direct BLOCK formatting (paragraph attrs: lineHeight). */
  paraDirect?: StyleProperties | null;
  /** Character-style definition (the charStyle mark's registry entry). */
  char?: StyleDefinition | null;
  /** Direct run marks (bold/italic/textStyle/underline/strike). */
  direct?: StyleProperties | null;
}

/** Pick the first PRESENT value walking the tiers strong → weak. */
function pick<T>(strong: T | undefined, ...rest: Array<T | undefined>): T {
  for (const v of [strong, ...rest]) {
    if (v !== undefined) return v;
  }
  throw new Error('resolveRun: cascade exhausted — base tier must be complete');
}

export function resolveRun(tiers: ResolveRunTiers): RunStyle {
  const base = tiers.base;
  const para = tiers.para?.properties ?? undefined;
  const paraDirect = tiers.paraDirect ?? undefined;
  const char = tiers.char?.properties ?? undefined;
  const direct = tiers.direct ?? undefined;

  return {
    fontFamily: pick(direct?.fontFamily, char?.fontFamily, paraDirect?.fontFamily, para?.fontFamily, base.fontFamily),
    fontSize: pick(direct?.fontSize, char?.fontSize, paraDirect?.fontSize, para?.fontSize, base.fontSize),
    bold: pick(direct?.bold, char?.bold, paraDirect?.bold, para?.bold, base.bold),
    italic: pick(direct?.italic, char?.italic, paraDirect?.italic, para?.italic, base.italic),
    underline: pick(direct?.underline, char?.underline, paraDirect?.underline, para?.underline, base.underline),
    strike: pick(direct?.strike, char?.strike, paraDirect?.strike, para?.strike, base.strike),
    color: pick(direct?.color, char?.color, paraDirect?.color, para?.color, base.color),
    lineHeight: pick(direct?.lineHeight, char?.lineHeight, paraDirect?.lineHeight, para?.lineHeight, base.lineHeight),
    fontVariant: pick(direct?.fontVariant, char?.fontVariant, paraDirect?.fontVariant, para?.fontVariant, base.fontVariant),
    textTransform: pick(
      direct?.textTransform,
      char?.textTransform,
      paraDirect?.textTransform,
      para?.textTransform,
      base.textTransform
    ),
  };
}

// ─── Block-tier resolution (geometry + alignment) ─────────────────────────

export interface BlockTier {
  spaceBefore?: number;
  spaceAfter?: number;
  indentLeft: number;
  indentRight: number;
  firstLineIndent?: number;
  align: TextAlign;
}

export interface BlockTierAttrs {
  spaceBefore?: unknown;
  spaceAfter?: unknown;
  indentLeft?: unknown;
  indentRight?: unknown;
  firstLineIndent?: unknown;
  textAlign?: unknown;
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Paragraph-tier geometry: direct ATTRS beat the paragraph-style
 * properties (set = non-default attr value), which beat the baseline
 * (0 / left). `baseIndentLeft` is the projection's structural indent
 * (list depth gutter, blockquote gutter) — always present, never a
 * style concern.
 */
export function resolveBlockTier(
  para: StyleDefinition | null,
  attrs: BlockTierAttrs,
  baseIndentLeft = 0
): BlockTier {
  const p = para?.properties;
  const attrSpaceBefore = numOrUndefined(attrs.spaceBefore);
  const attrSpaceAfter = numOrUndefined(attrs.spaceAfter);
  const attrIndentLeft = numOrUndefined(attrs.indentLeft);
  const attrIndentRight = numOrUndefined(attrs.indentRight);
  const attrFirstLine = numOrUndefined(attrs.firstLineIndent);
  const attrAlign =
    attrs.textAlign === 'center' || attrs.textAlign === 'right' ? (attrs.textAlign as TextAlign) : undefined;

  return {
    spaceBefore: attrSpaceBefore !== undefined && attrSpaceBefore > 0
      ? attrSpaceBefore
      : (p?.spaceBefore ?? undefined),
    spaceAfter: attrSpaceAfter !== undefined && attrSpaceAfter > 0 ? attrSpaceAfter : (p?.spaceAfter ?? undefined),
    indentLeft: baseIndentLeft + (attrIndentLeft ?? p?.indentLeft ?? 0),
    indentRight: attrIndentRight ?? p?.indentRight ?? 0,
    firstLineIndent: attrs.firstLineIndent != null ? attrFirstLine : p?.firstLineIndent,
    align: attrAlign ?? (p?.textAlign as TextAlign | undefined) ?? 'left',
  };
}

// ─── Text transform (adapter-side; the engine measures the result) ─────────

/**
 * Apply a length-preserving text transform to RUN TEXT during adapter
 * resolution — the engine then measures the TRANSFORMED text, so wraps
 * are correct (uppercase is wider than source in real fonts). PM keeps
 * the source text: selection, find, and clipboard all work in source
 * coordinates, and the length-preserving invariant keeps engine
 * offsets identity-mapped to PM offsets (asserted — a transform that
 * changed length would silently misplace every caret after it, so it
 * throws instead).
 *
 * 'capitalize'/'title-case' mirror CSS text-transform: capitalize —
 * the FIRST LETTER of each word is uppercased, every other character
 * is left untouched (CSS spec wording: "other characters are
 * unaffected"). Word boundary = "previous character was not a
 * letter" (Unicode-aware). DOCUMENTED DIVERGENCE: browser engines may
 * resolve word boundaries around punctuation/digits differently from
 * this JS spelling; both modes agree with each other via this function
 * for paginated and via CSS for pageless, and the edge-word parity is
 * pinned by test — where a browser diverges, the test documents it
 * rather than silently shipping it.
 *
 * UPPERCASE/LOWERCASE DIVERGENCE (v1): a few characters change length
 * under case mapping — ß → 'SS' is the canonical one. CSS would render
 * the expansion; v1 LEAVES length-changing characters UNCHANGED
 * (ß stays ß under uppercase) so the length-preserving invariant —
 * and with it the PM↔engine offset identity — holds for every
 * document, not just ASCII. True expanded mapping needs
 * transformed-offset bookkeeping in the position bridge; 'M-later'.
 */
export function transformText(text: string, transform: TextTransform): string {
  if (transform === 'none' || transform === undefined) return text;
  let out: string;
  switch (transform) {
    case 'uppercase':
    case 'lowercase': {
      const up = transform === 'uppercase';
      out = '';
      for (const ch of text) {
        const mapped = up ? ch.toUpperCase() : ch.toLowerCase();
        // Length-changing mappings (ß → SS, ligatures) stay UNCHANGED —
        // the v1 ban is on length change itself.
        out += mapped.length === 1 ? mapped : ch;
      }
      break;
    }
    case 'capitalize':
    case 'title-case': {
      out = '';
      let prevLetter = false;
      for (const ch of text) {
        const isLetter = /\p{L}/u.test(ch);
        let mapped = isLetter && !prevLetter ? ch.toUpperCase() : ch;
        if (mapped.length !== 1) mapped = ch; // ß and friends: see the note above
        out += mapped;
        prevLetter = isLetter;
      }
      break;
    }
    default:
      out = text;
  }
  if (out.length !== text.length) {
    // The v1 ban, encoded: length-changing transforms break the
    // PM↔engine offset identity. Unreachable for the allowed value
    // set — this is the tripwire.
    throw new Error(
      `[styles] textTransform '${transform}' changed text length — length-changing transforms are banned in v1`
    );
  }
  return out;
}

// ─── baseStyle := resolve('normal') (amendment 6) ─────────────────────────

/**
 * The document baseStyle is the resolved 'normal' style: absent
 * properties fall to the config defaults, an edited 'normal' overrides
 * them. Re-derived by callers on every registry epoch bump; the
 * existing baseStyleHash / adapter-generation path carries it into the
 * engine (empty lines measure under baseStyle, so they restyle too).
 */
export function resolveNormalBase(
  fontFamily: string,
  fontSize: number,
  definitions: Record<string, StyleDefinition>
): TextStyle {
  const normal = definitions['normal'];
  return {
    fontFamily: normal?.properties.fontFamily ?? fontFamily,
    fontSize: normal?.properties.fontSize ?? fontSize,
  };
}

// ─── Capture (reverse resolution — "create style from selection") ─────────

/**
 * The definition-capture half of resolution: given the EFFECTIVE
 * resolved style at a selection and the baseline it would have had,
 * emit the properties that DIFFER. Test receipt: capture from a
 * directly-bolded Normal span → { bold: true } in the definition.
 */
export function captureFromResolved(resolved: RunStyle, baseline: RunStyle): StyleProperties {
  const props: StyleProperties = {};
  if (resolved.fontFamily !== baseline.fontFamily) props.fontFamily = resolved.fontFamily;
  if (resolved.fontSize !== baseline.fontSize) props.fontSize = resolved.fontSize;
  if (resolved.bold !== baseline.bold) props.bold = resolved.bold;
  if (resolved.italic !== baseline.italic) props.italic = resolved.italic;
  if (resolved.underline !== baseline.underline) props.underline = resolved.underline;
  if (resolved.strike !== baseline.strike) props.strike = resolved.strike;
  if (resolved.color !== baseline.color) props.color = resolved.color;
  if (resolved.lineHeight !== baseline.lineHeight) props.lineHeight = resolved.lineHeight;
  if (resolved.fontVariant !== baseline.fontVariant) props.fontVariant = resolved.fontVariant;
  if (resolved.textTransform !== baseline.textTransform) props.textTransform = resolved.textTransform;
  return props;
}

// ─── CSS serialization (pageless sheet + dialog preview — ONE mapper) ──────

/** CSS property pairs for a definition's properties. Only DEFINED
 * properties emit (bold: false emits font-weight: 400 — an explicit
 * override, not a guess). */
export function cssDeclarations(properties: StyleProperties): string[] {
  const p = properties;
  const decls: string[] = [];
  if (p.fontSize !== undefined) decls.push(`font-size: ${p.fontSize}px`);
  if (p.fontFamily !== undefined) decls.push(`font-family: ${p.fontFamily}`);
  if (p.bold !== undefined) decls.push(`font-weight: ${p.bold ? '700' : '400'}`);
  if (p.italic !== undefined) decls.push(`font-style: ${p.italic ? 'italic' : 'normal'}`);
  if (p.underline !== undefined || p.strike !== undefined) {
    const lines: string[] = [];
    if (p.underline) lines.push('underline');
    if (p.strike) lines.push('line-through');
    decls.push(`text-decoration: ${lines.length ? lines.join(' ') : 'none'}`);
  }
  if (p.color !== undefined) decls.push(`color: ${p.color}`);
  if (p.lineHeight !== undefined) decls.push(`line-height: ${p.lineHeight}`);
  if (p.spaceBefore !== undefined) decls.push(`margin-top: ${p.spaceBefore}px`);
  if (p.spaceAfter !== undefined) decls.push(`margin-bottom: ${p.spaceAfter}px`);
  if (p.indentLeft !== undefined) decls.push(`padding-left: ${p.indentLeft}px`);
  if (p.indentRight !== undefined) decls.push(`padding-right: ${p.indentRight}px`);
  if (p.firstLineIndent !== undefined) decls.push(`text-indent: ${p.firstLineIndent}px`);
  if (p.textAlign !== undefined) decls.push(`text-align: ${p.textAlign}`);
  if (p.fontVariant !== undefined) decls.push(`font-variant: ${p.fontVariant}`);
  if (p.textTransform !== undefined) {
    // 'title-case' has no CSS spelling — pageless renders capitalize
    // (the documented divergence; see transformText).
    const css = p.textTransform === 'title-case' ? 'capitalize' : p.textTransform === 'none' ? 'none' : p.textTransform;
    decls.push(`text-transform: ${css}`);
  }
  return decls;
}

/** Inline-style object form (React camelCase) of the SAME mapping —
 * the style dialog's live preview renders through it so preview and
 * pageless sheet can never drift. */
export function inlineStyle(properties: StyleProperties): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const decl of cssDeclarations(properties)) {
    const idx = decl.indexOf(':');
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}
