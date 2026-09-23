import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useDocumentStore } from '@/lib/document/store';
import { PAGE_SIZES } from '@/lib/document/pageSetup';

const PAGE_SIZE_KEYS = Object.keys(PAGE_SIZES);

/**
 * STEP 4c (M4) — the ONLY UI addition this milestone: Review > Document
 * Properties. ONE live control: Paper Size, writing
 * useDocumentStore.setPageSetup; it persists for free via .wpdoc metadata
 * (document/fileOperations.ts) and reflows the PaginatedView per L4 (the
 * view reads pageSetup from the store per layout call). Everything else
 * is a disabled placeholder — the Layout-tab PageSetupGroup placeholders
 * stay disabled: ONE entrance.
 */
export function DocumentPropertiesDialog() {
  const isOpen = useDocumentPropertiesStore((s) => s.isOpen);
  const close = useDocumentPropertiesStore((s) => s.close);
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const setPageSetup = useDocumentStore((s) => s.setPageSetup);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document Properties</DialogTitle>
          <DialogDescription>
            Page setup for this document. Changes reflow the document and are saved with it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm">Paper size</span>
            <Select
              value={pageSetup.pageSize}
              onValueChange={(value) => {
                if (value != null) setPageSetup({ ...pageSetup, pageSize: value });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm">Orientation</span>
            <Input value="Portrait" disabled readOnly className="h-8" />
          </div>

          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm">Margins (px)</span>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={String(pageSetup.margins.top)}
                disabled
                readOnly
                aria-label="Top margin"
                className="h-8"
              />
              <Input
                value={String(pageSetup.margins.bottom)}
                disabled
                readOnly
                aria-label="Bottom margin"
                className="h-8"
              />
              <Input
                value={String(pageSetup.margins.left)}
                disabled
                readOnly
                aria-label="Left margin"
                className="h-8"
              />
              <Input
                value={String(pageSetup.margins.right)}
                disabled
                readOnly
                aria-label="Right margin"
                className="h-8"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}