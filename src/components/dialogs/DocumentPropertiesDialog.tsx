import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';

/**
 * Review > Document Properties (M5.13): reserved for document
 * metadata (title, author, tags). The page-setup controls that used
 * to live here moved to the Layout tab; statistics live in Review >
 * Document Statistics.
 */
export function DocumentPropertiesDialog() {
  const isOpen = useDocumentPropertiesStore((s) => s.isOpen);
  const close = useDocumentPropertiesStore((s) => s.close);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document Properties</DialogTitle>
          <DialogDescription>Metadata for this document.</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Document metadata (title, author, tags) is not implemented yet. Page setup lives in
          the Layout tab; statistics in Review &gt; Document Statistics.
        </p>
      </DialogContent>
    </Dialog>
  );
}
