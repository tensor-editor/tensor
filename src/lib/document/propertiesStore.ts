import { create } from 'zustand';

interface DocumentPropertiesStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useDocumentPropertiesStore = create<DocumentPropertiesStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));