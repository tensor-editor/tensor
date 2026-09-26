import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useDocumentStore } from '@/lib/document/store';
import { getDocumentStats } from '@/lib/editor/documentStats';

/**
 * Review > Document Statistics: read-only document
 * information — file, pages, words, characters.
 */
export function DocumentStatisticsDialog() {
  const isOpen = useDocumentPropertiesStore((s) => s.statsIsOpen);
  const closeStats = useDocumentPropertiesStore((s) => s.closeStats);
  const editor = useDocumentStore((s) => s.editor);
  const filePath = useDocumentStore((s) => s.filePath);
  const pageCount = useDocumentStore((s) => s.pageCount);

  const stats = editor ? getDocumentStats(editor) : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeStats(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document Statistics</DialogTitle>
          <DialogDescription>Information about this document.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm text-muted-foreground">File</span>
            <span className="truncate text-sm">{filePath ?? 'Untitled'}</span>
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm text-muted-foreground">Pages</span>
            <span className="text-sm">{pageCount}</span>
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm text-muted-foreground">Words</span>
            <span className="text-sm">{stats?.words ?? 0}</span>
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm text-muted-foreground">Characters</span>
            <span className="text-sm">{stats?.charactersWithSpaces ?? 0}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
