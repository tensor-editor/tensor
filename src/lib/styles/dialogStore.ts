import { create } from 'zustand';
import type { StyleKind } from './types';
import type { StyleDialogState } from '@/components/dialogs/StyleDialog';

interface StyleDialogStore extends StyleDialogState {
  openDialog: (editingId: string | null, kind: StyleKind) => void;
  close: () => void;
}

/** Global home of the style create/edit dialog so any surface (Styles
 *  dropdown, command palette) can open it — the dialog itself renders
 *  exactly once, from App, fed by this store. `open` (bool) is the
 *  dialog visibility; `openDialog` is the action. */
export const useStyleDialogStore = create<StyleDialogStore>((set) => ({
  open: false,
  editingId: null,
  kind: 'paragraph',
  openDialog: (editingId, kind) => set({ open: true, editingId, kind }),
  close: () => set({ open: false }),
}));
