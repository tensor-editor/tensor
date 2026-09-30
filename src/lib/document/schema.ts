import { z } from 'zod';
import type { PageSetup } from './pageSetup';
import { StyleDefinitionSchema, type StyleDefinition } from '@/lib/styles/types';

export const CURRENT_DOCUMENT_VERSION = 1;

const PageSetupSchema = z.object({
  pageSize: z.string(),
  margins: z.object({
    top: z.number(),
    bottom: z.number(),
    left: z.number(),
    right: z.number(),
  }),
  pageGap: z.number(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  pageColor: z.string().optional(),
  customWidth: z.number().optional(),
  customHeight: z.number().optional(),
}) satisfies z.ZodType<PageSetup>;

/**
 * M-STYLES: the document's own style definitions (the DOC layer of
 * the registry merge — doc overrides global by id; see
 * lib/styles/registry.ts). Optional: old files predate styles and
 * merge as an empty layer. The styleIds on the document's paragraphs
 * ride docJSON (the PM document) — this field carries the DEFINITIONS
 * the document depends on beyond the global registry.
 */
const DocStylesSchema = z.object({
  definitions: z.array(StyleDefinitionSchema).default([]),
});

/**
 * M-LINENUMS: the document's line-number gutter setting. Optional —
 * old files predate it and open with the gutter off (the styles
 * precedent). countBy is metadata-only in v1 (no ribbon UI): the
 * counter advances on every line; a number is SHOWN only when
 * (n−1) % countBy === 0, else the line renders blank.
 */
export const LineNumbersSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['continuous', 'per-page', 'per-paragraph']),
  countBy: z.number().int().min(1).optional(),
});

export type LineNumbersSetting = z.infer<typeof LineNumbersSchema>;

export const DocumentFileSchema = z.object({
  version: z.number(),
  docJSON: z.any(),
  metadata: z.object({
    title: z.string().optional(),
    createdAt: z.string().optional(),
    modifiedAt: z.string().optional(),
    originalPath: z.string().optional(),
    pageSetup: PageSetupSchema.optional(),
    styles: DocStylesSchema.optional(),
    lineNumbers: LineNumbersSchema.optional(),
  }).default({}),
});

export type DocumentFile = z.infer<typeof DocumentFileSchema>;
export type { StyleDefinition };
