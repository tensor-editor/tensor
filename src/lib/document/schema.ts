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
  }).default({}),
});

export type DocumentFile = z.infer<typeof DocumentFileSchema>;
export type { StyleDefinition };
