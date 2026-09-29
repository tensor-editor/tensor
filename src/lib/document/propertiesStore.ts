import { create } from 'zustand';

interface DocumentPropertiesStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  marginsIsOpen: boolean;
  openMargins: () => void;
  closeMargins: () => void;
  statsIsOpen: boolean;
  openStats: () => void;
  closeStats: () => void;
  customSizeIsOpen: boolean;
  openCustomSize: () => void;
  closeCustomSize: () => void;
}

export const useDocumentPropertiesStore = create<DocumentPropertiesStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  marginsIsOpen: false,
  openMargins: () => set({ marginsIsOpen: true }),
  closeMargins: () => set({ marginsIsOpen: false }),
  statsIsOpen: false,
  openStats: () => set({ statsIsOpen: true }),
  closeStats: () => set({ statsIsOpen: false }),
  customSizeIsOpen: false,
  openCustomSize: () => set({ customSizeIsOpen: true }),
  closeCustomSize: () => set({ customSizeIsOpen: false }),
}));