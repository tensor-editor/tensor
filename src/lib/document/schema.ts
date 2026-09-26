import { z } from 'zod';
import type { PageSetup } from './pageSetup';

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

export const DocumentFileSchema = z.object({
  version: z.number(),
  docJSON: z.any(),
  metadata: z.object({
    title: z.string().optional(),
    createdAt: z.string().optional(),
    modifiedAt: z.string().optional(),
    originalPath: z.string().optional(),
    pageSetup: PageSetupSchema.optional(),
  }).default({}),
});

export type DocumentFile = z.infer<typeof DocumentFileSchema>;
