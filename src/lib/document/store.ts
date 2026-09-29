import { create } from 'zustand';
import type { Editor } from '@tiptap/core';
import { message } from '@tauri-apps/plugin-dialog';
import { saveDocument, saveDocumentAs, openDocument } from './fileOperations';
import { clearRecoveryCopy } from './recovery';
import { useConfigStore } from '../config/store';
import type { PageSetup } from './pageSetup';

function defaultPageSetup(): PageSetup {
  const { config } = useConfigStore.getState();
  return {
    pageSize: config.editor.defaultPageSize,
    margins: config.editor.defaultMargins,
    pageGap: config.editor.defaultPageGap,
  };
}

interface DocumentStore {
  editor: Editor | null;
  filePath: string | null;
  isDirty: boolean;
  revision: number;
  pageSetup: PageSetup;
  setEditor: (editor: Editor | null) => void;
  markDirty: () => void;
  setPageSetup: (pageSetup: PageSetup) => void;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  openFile: () => Promise<void>;
  pageCount: number;
  currentPage: number;
  setPageInfo: (pageCount: number, currentPage: number) => void;
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  editor: null,
  filePath: null,
  isDirty: false,
  revision: 0,
  pageSetup: defaultPageSetup(),
  pageCount: 1,
  currentPage: 1,
  setPageInfo: (pageCount, currentPage) => set({ pageCount, currentPage }),

  setEditor: (editor) => set({ editor }),
  markDirty: () => set((state) => ({ isDirty: true, revision: state.revision + 1 })),
  setPageSetup: (pageSetup) => set({ pageSetup, isDirty: true }),

  save: async () => {
    const { editor, filePath, pageSetup } = get();
    if (!editor) return;
    if (!filePath) {
      await get().saveAs();
      return;
    }
    await saveDocument(editor, filePath, pageSetup);
    await clearRecoveryCopy(filePath);
    set({ isDirty: false });
  },

  saveAs: async () => {
    const { editor, filePath: oldPath, pageSetup } = get();
    if (!editor) return;
    const newPath = await saveDocumentAs(editor, pageSetup);
    if (newPath) {
      await clearRecoveryCopy(oldPath);
      set({ filePath: newPath, isDirty: false });
    }
  },

  openFile: async () => {
    const { editor } = get();
    if (!editor) return;
    try {
      const result = await openDocument(editor);
      if (result) {
        set({
          filePath: result.path,
          isDirty: false,
          pageSetup: result.pageSetup ?? defaultPageSetup(),
        });
      }
    } catch (err) {
      await message(err instanceof Error ? err.message : 'Failed to open document', {
        title: 'Error',
        kind: 'error',
      });
    }
  },
}));

// The store above is created at module init — before the persisted
// config.json is loaded by useConfigPersistence — so the initial
// pageSetup captures pre-load defaults. Re-derive it from the config
// store whenever that changes, but only while the document is pristine:
// once a file is opened (it carries its own pageSetup) or the current
// one is edited, the document owns its setup.
useConfigStore.subscribe(() => {
  const { filePath, isDirty } = useDocumentStore.getState();
  if (!filePath && !isDirty) {
    useDocumentStore.setState({ pageSetup: defaultPageSetup() });
  }
});
