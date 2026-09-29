import { z } from 'zod';

/**
 * M-STYLES model. A style is a NAMED, ADDRESSABLE set of typographic
 * properties — never a bundle of stamped attrs. Documents reference
 * styles by id (`styleId` on paragraphs, the `charStyle` mark on runs);
 * the registry owns the definitions; resolution happens adapter-side
 * in ONE function (resolve.ts — resolveRun), never in the engine.
 *
 * INVARIANT (schema-level): every paragraph carries a `styleId`
 * (attr default 'normal', non-optional). Old documents get it via the
 * attr default on load — no migration pass. Headings carry
 * `heading-{level}` (the HeadingSync plugin maintains the alignment;
 * the adapter resolves headings through `heading-{level}`, the attr's
 * guaranteed twin).
 */

export type StyleKind = 'paragraph' | 'character';

/**
 * Length-preserving text casing transforms. 'capitalize'/'title-case'
 * uppercase the FIRST LETTER of each word only — every allowed value
 * maps source chars to output chars 1:1, which is what keeps PM source
 * coordinates and engine (transformed) offsets identity-mapped.
 * Length-changing transforms (camelCase included — ruled out as a
 * CONTENT transform, not typography) are BANNED from v1; transformText
 * enforces the invariant by assertion.
 * 'title-case' renders as CSS capitalize in pageless (documented
 * divergence: browsers may word-boundary differently on punctuation;
 * true title-case word lists are future scope, revisit 'M-later').
 */
export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize' | 'title-case' | 'none';

export const StylePropertiesSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: z.string().optional(),
  /** Highlight background (the same mark the ribbon's Highlighter
   * button sets). */
  highlight: z.string().optional(),
  lineHeight: z.number().positive().optional(),
  spaceBefore: z.number().optional(),
  spaceAfter: z.number().optional(),
  indentLeft: z.number().optional(),
  indentRight: z.number().optional(),
  firstLineIndent: z.number().optional(),
  /**
   * 'justify' shares the adapter's existing loud ruling: pageless
   * renders it natively; paginated treats it as left + the
   * dropped-attr warning (justify is engine work, stays loud — the
   * same semantics the textAlign ATTR already has).
   */
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  fontVariant: z.enum(['small-caps', 'normal']).optional(),
  textTransform: z.enum(['uppercase', 'lowercase', 'capitalize', 'title-case', 'none']).optional(),
});

export type StyleProperties = z.infer<typeof StylePropertiesSchema>;

export const StyleDefinitionSchema = z.object({
  id: z.string().min(1),
  /** Display name. Rename changes name ONLY — never id. */
  name: z.string().min(1),
  kind: z.enum(['paragraph', 'character']),
  properties: StylePropertiesSchema.default({}),
});

export type StyleDefinition = z.infer<typeof StyleDefinitionSchema>;

/** The fixed built-in registry ids. These can be EDITED (name and
 * properties, via the registry-epoch path) but never DELETED and
 * never renamed (id is identity). */
export const BUILTIN_PARAGRAPH_IDS = ['normal', 'heading-1', 'heading-2', 'heading-3', 'quote'] as const;
export const BUILTIN_CHARACTER_IDS = ['emphasis', 'strong'] as const;
export const BUILTIN_IDS = [...BUILTIN_PARAGRAPH_IDS, ...BUILTIN_CHARACTER_IDS] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

export function isBuiltinId(id: string): id is BuiltinId {
  return (BUILTIN_IDS as readonly string[]).includes(id);
}

/** The heading tier's reserved id spelling (`heading-1` .. `heading-6`).
 * The Dropdown exposes 1..3 as built-ins; 4..6 are keyboard-only
 * levels whose visual defaults live in builtins.ts (legacy fallback). */
export function headingStyleId(level: number): string {
  return `heading-${level}`;
}

export function isHeadingStyleId(id: string): boolean {
  return /^heading-[1-6]$/.test(id);
}

/**
 * The registry snapshot the ADAPTER consumes (pure data — the adapter
 * never imports the zustand store; callers build this from store
 * state, tests construct it directly). `epoch` is the registry-epoch
 * mirror of the engine's baseStyleHash: ANY definition edit bumps it,
 * invalidating the adapter's identity cache wholesale (every block
 * re-converts → new resolved runs → the engine's contentHash decides
 * what re-breaks; paint-tier facts like color reach the canvas even
 * when the engine splices).
 */
export interface StyleRegistrySnapshot {
  definitions: Record<string, StyleDefinition>;
  epoch: number;
}
