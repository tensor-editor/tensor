import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';

/**
 * Review > Document Properties — METADATA ONLY (M6 ruling). Live
 * controls do not live here: margins are in Layout > Margins,
 * statistics in Review > Document Statistics, paper setup in Layout >
 * Page Setup. The metadata section (title, author, tags) is clearly
 * labeled future scope and renders as a placeholder until it ships.
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

        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Document metadata — future scope</p>
          <p className="mt-1">
            Title, author, and tags are not implemented yet. Live controls live elsewhere:
            margins in <strong>Layout &gt; Margins</strong>, paper size and orientation in{' '}
            <strong>Layout &gt; Page Setup</strong>, statistics in{' '}
            <strong>Review &gt; Document Statistics</strong>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
