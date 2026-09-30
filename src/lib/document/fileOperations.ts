import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
import type { Editor } from '@tiptap/core';
import { DocumentFileSchema, CURRENT_DOCUMENT_VERSION, type DocumentFile, type LineNumbersSetting } from './schema';
import type { PageSetup } from './pageSetup';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import type { StyleDefinition } from '@/lib/styles/types';

const FILE_FILTERS = [{ name: 'Word Processor Document', extensions: ['wpdoc'] }];

async function writeDocumentAtomic(filePath: string, file: DocumentFile): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeTextFile(tempPath, JSON.stringify(file, null, 2));
  await rename(tempPath, filePath);
}

export async function saveDocument(
  editor: Editor,
  filePath: string,
  pageSetup: PageSetup,
  lineNumbers?: LineNumbersSetting | null
): Promise<void> {
  const file: DocumentFile = {
    version: CURRENT_DOCUMENT_VERSION,
    docJSON: editor.getJSON(),
    metadata: {
      modifiedAt: new Date().toISOString(),
      pageSetup,
      // M-STYLES: the doc layer round-trips verbatim — definitions
      // the file carried (or that were applied to it on open) travel
      // with it; global-layer edits live in styles.json, not here.
      styles: { definitions: useStyleRegistryStore.getState().docLayerForSave() },
      // M-LINENUMS: absent when never set (old docs / gutter off by
      // default) — the styles optional-field precedent.
      ...(lineNumbers ? { lineNumbers } : {}),
    },
  };
  await writeDocumentAtomic(filePath, file);
}

export async function saveDocumentAs(
  editor: Editor,
  pageSetup: PageSetup,
  lineNumbers?: LineNumbersSetting | null
): Promise<string | null> {
  const path = await save({ filters: FILE_FILTERS, defaultPath: 'Untitled.wpdoc' });
  if (!path) return null;
  await saveDocument(editor, path, pageSetup, lineNumbers);
  return path;
}

export interface OpenDocumentResult {
  path: string;
  pageSetup: PageSetup | null;
  /** M-STYLES: the file's doc-layer style definitions (may be empty —
   *  pre-styles files). The document store applies them to the
   *  registry (doc overrides global by id). */
  styleDefinitions: StyleDefinition[];
  /** M-LINENUMS: the file's gutter setting; null = the file predates
   *  it or never enabled it. */
  lineNumbers: LineNumbersSetting | null;
}

export async function openDocument(editor: Editor): Promise<OpenDocumentResult | null> {
  const path = await open({ filters: FILE_FILTERS, multiple: false });
  if (!path || Array.isArray(path)) return null;

  const raw = await readTextFile(path);
  const parsed = JSON.parse(raw);
  const result = DocumentFileSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error('This file is not a valid document, or was saved by an incompatible version.');
  }

  editor.commands.setContent(result.data.docJSON);
  return {
    path,
    pageSetup: result.data.metadata.pageSetup ?? null,
    styleDefinitions: result.data.metadata.styles?.definitions ?? [],
    lineNumbers: result.data.metadata.lineNumbers ?? null,
  };
}
