import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
import type { Editor } from '@tiptap/core';
import { DocumentFileSchema, CURRENT_DOCUMENT_VERSION, type DocumentFile } from './schema';
import type { PageSetup } from './pageSetup';

const FILE_FILTERS = [{ name: 'Word Processor Document', extensions: ['wpdoc'] }];

async function writeDocumentAtomic(filePath: string, file: DocumentFile): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeTextFile(tempPath, JSON.stringify(file, null, 2));
  await rename(tempPath, filePath);
}

export async function saveDocument(editor: Editor, filePath: string, pageSetup: PageSetup): Promise<void> {
  const file: DocumentFile = {
    version: CURRENT_DOCUMENT_VERSION,
    docJSON: editor.getJSON(),
    metadata: {
      modifiedAt: new Date().toISOString(),
      pageSetup,
    },
  };
  await writeDocumentAtomic(filePath, file);
}

export async function saveDocumentAs(editor: Editor, pageSetup: PageSetup): Promise<string | null> {
  const path = await save({ filters: FILE_FILTERS, defaultPath: 'Untitled.wpdoc' });
  if (!path) return null;
  await saveDocument(editor, path, pageSetup);
  return path;
}

export interface OpenDocumentResult {
  path: string;
  pageSetup: PageSetup | null;
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
  return { path, pageSetup: result.data.metadata.pageSetup ?? null };
}
