import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import {
  MEASUREMENT_UNITS,
  formatPt,
  parseUnitToPt,
  type Margins,
  type MeasurementUnit,
} from '@/lib/document/pageSetup';

type MarginKey = keyof Margins;

const FIELDS: Array<{ key: MarginKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

function snapshot(margins: Margins, unit: MeasurementUnit): Record<MarginKey, string> {
  return {
    top: formatPt(margins.top, unit),
    bottom: formatPt(margins.bottom, unit),
    left: formatPt(margins.left, unit),
    right: formatPt(margins.right, unit),
  };
}

/**
 * Layout > Margins: four live inputs writing
 * useDocumentStore.setPageSetup.margins (in POINTS) — changes reflow
 * the document immediately (the engine consumes margins on every
 * layout) and persist via .wpdoc metadata. Inputs display in the
 * user's measurement unit (config.editor.measurementUnit).
 */
export function MarginsDialog() {
  const isOpen = useDocumentPropertiesStore((s) => s.marginsIsOpen);
  const closeMargins = useDocumentPropertiesStore((s) => s.closeMargins);
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const setPageSetup = useDocumentStore((s) => s.setPageSetup);
  const unit = useConfigStore((s) => s.config.editor.measurementUnit);

  const [draft, setDraft] = useState<Record<MarginKey, string>>(() =>
    snapshot(pageSetup.margins, unit),
  );

  // Re-sync the draft from the store each time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setDraft(snapshot(pageSetup.margins, unit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function commit(key: MarginKey, raw: string) {
    setDraft((d) => ({ ...d, [key]: raw }));
    const pt = parseUnitToPt(raw, unit);
    if (pt != null && pt >= 0 && pt !== pageSetup.margins[key]) {
      setPageSetup({
        ...pageSetup,
        margins: { ...pageSetup.margins, [key]: pt },
      });
    }
  }

  const suffix = MEASUREMENT_UNITS[unit].suffix;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeMargins(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Margins</DialogTitle>
          <DialogDescription>
            Page margins in {MEASUREMENT_UNITS[unit].label.toLowerCase()}. Changes reflow the document immediately and are saved with it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <span className="w-14 text-muted-foreground">{label}</span>
              <Input
                type="number"
                min={0}
                step={0.25}
                className="h-8"
                aria-label={`${label} margin`}
                value={draft[key]}
                onChange={(e) => commit(key, e.target.value)}
              />
              <span className="w-4 text-xs text-muted-foreground">{suffix}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button size="sm" onClick={closeMargins}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
