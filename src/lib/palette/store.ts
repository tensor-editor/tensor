import { create } from 'zustand';
import { useDocumentStore } from '@/lib/document/store';

interface PaletteStore {
  isOpen: boolean;
  /** Whether the editor had focus at open time. Editor-context
   *  commands surface only for such invocations; on close, focus is
   *  returned to the editor (selection untouched — the palette is
   *  overlay chrome and never writes PM state, so the caret comes
   *  back exactly where it was). */
  editorContext: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const usePaletteStore = create<PaletteStore>((set, get) => ({
  isOpen: false,
  editorContext: false,

  open: () =>
    set({
      isOpen: true,
      editorContext: useDocumentStore.getState().editor?.isFocused ?? false,
    }),

  close: () => {
    const { editorContext } = get();
    set({ isOpen: false, editorContext: false });
    if (editorContext) {
      // Deferred past the dialog's unmount (its own focus-restore runs
      // in the same React commit and would otherwise win). The PM
      // selection was never touched — focus() brings the caret back
      // exactly where it was.
      setTimeout(() => {
        useDocumentStore.getState().editor?.commands.focus();
      }, 0);
    }
  },

  toggle: () => (get().isOpen ? get().close() : get().open()),
}));
