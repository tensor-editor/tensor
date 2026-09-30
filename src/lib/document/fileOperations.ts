import { save, open } from '@tauri-apps/plugin-dialog';
import type { Editor } from '@tiptap/core';
import { CURRENT_DOCUMENT_VERSION, type DocumentFile, type LineNumbersSetting } from './schema';
import type { PageSetup } from './pageSetup';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import type { StyleDefinition } from '@/lib/styles/types';
import { openWpdoc, saveWpdoc } from './wpdoc';

const FILE_FILTERS = [{ name: 'Word Processor Document', extensions: ['wpdoc'] }];

/**
 * M-IMAGES-0: .wpdoc v2 — saves write the zip container (the Rust
 * package_document command; ATOMIC temp+rename lives Rust-side now,
 * the old writeDocumentAtomic pattern moved with it). The media set
 * packaged is the document's REFERENCED media only (saveWpdoc's GC).
 */
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
  await saveWpdoc(filePath, file);
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

  // M-IMAGES-0: v2 container — or v1 plain JSON via the PERMANENT
  // converter (openWpdoc detects the NOT_ZIP marker). Corrupted files
  // throw here; the store's open path surfaces the LOUD error dialog
  // (never a crash, never silent loss — the corrupted→defaults
  // posture's document-side spelling).
  const file = await openWpdoc(path);

  editor.commands.setContent(file.docJSON);
  return {
    path,
    pageSetup: file.metadata.pageSetup ?? null,
    styleDefinitions: file.metadata.styles?.definitions ?? [],
    lineNumbers: file.metadata.lineNumbers ?? null,
  };
}
