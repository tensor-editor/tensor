import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMediaStore } from '@/lib/media/store';
import { create } from 'zustand';
import { useDocumentStore } from '@/lib/document/store';

/**
 * M-IMAGES-1.5 — the image dialogs. The external-URL DOWNLOAD dialog
 * is GONE (the dead code path removed): an http(s) image paste is
 * refused with a toast, zero network calls (the fonts privacy
 * precedent, hardened). What remains:
 *  - ALT TEXT: metadata, not display — writes the node's alt attr
 *    (the hidden PM view's <img alt> is the a11y surface).
 */

interface AltTextStore {
  isOpen: boolean;
  /** The PM position of the image node being edited. */
  pos: number | null;
  alt: string;
  src: string | null;
  open: (pos: number, alt: string, src: string | null) => void;
  close: () => void;
  setAlt: (alt: string) => void;
}

export const useAltTextStore = create<AltTextStore>((set) => ({
  isOpen: false,
  pos: null,
  alt: '',
  src: null,
  open: (pos, alt, src) => set({ isOpen: true, pos, alt, src }),
  close: () => set({ isOpen: false, pos: null }),
  setAlt: (alt) => set({ alt }),
}));

export function AltTextDialog() {
  const isOpen = useAltTextStore((s) => s.isOpen);
  const pos = useAltTextStore((s) => s.pos);
  const alt = useAltTextStore((s) => s.alt);
  const src = useAltTextStore((s) => s.src);
  const close = useAltTextStore((s) => s.close);
  const setAlt = useAltTextStore((s) => s.setAlt);

  const entryId = src?.startsWith('media://') ? src.slice('media://'.length) : null;
  const preview = useMediaStore((s) => (entryId ? s.entries.get(entryId) : undefined));

  function save() {
    const editor = useDocumentStore.getState().editor;
    if (editor && pos != null) {
      editor
        .chain()
        .command(({ tr, dispatch }) => {
          if (dispatch) tr.setNodeAttribute(pos, 'alt', alt);
          return true;
        })
        .run();
    }
    close();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Alt Text</DialogTitle>
          <DialogDescription>
            Describes the image to screen readers — metadata, not display.
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <img src={preview.url} alt="" className="mx-auto max-h-32 rounded-lg border object-contain" />
        )}
        <Input
          data-testid="alt-text-input"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button data-testid="alt-text-save" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
