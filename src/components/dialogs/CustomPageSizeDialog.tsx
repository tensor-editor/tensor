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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import {
  MEASUREMENT_UNITS,
  PAGE_SIZES,
  FALLBACK_PAGE_SIZE,
  findMatchingPreset,
  formatPt,
  parseUnitToPt,
  type MeasurementUnit,
} from '@/lib/document/pageSetup';

// 2"–52" in points — the acceptable custom page range.
const MIN_PT = 2 * 72;
const MAX_PT = 52 * 72;

/**
 * Layout > Paper Size > Custom… : width/height inputs displayed in the
 * user's measurement unit (config.editor.measurementUnit). Changes apply
 * only on "Done" — Cancel (or X / click-away) leaves the current page
 * size untouched. The store holds POINTS (customWidth/customHeight);
 * this dialog converts at the boundary. If the entered dimensions
 * match a preset, the preset is used instead of 'custom'.
 */
export function CustomPageSizeDialog() {
  const isOpen = useDocumentPropertiesStore((s) => s.customSizeIsOpen);
  const closeCustomSize = useDocumentPropertiesStore((s) => s.closeCustomSize);
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const setPageSetup = useDocumentStore((s) => s.setPageSetup);
  const unit = useConfigStore((s) => s.config.editor.measurementUnit);
  const setMeasurementUnit = useConfigStore((s) => s.setMeasurementUnit);

  const [draft, setDraft] = useState({ width: '', height: '' });

  useEffect(() => {
    if (isOpen) {
      const preset = PAGE_SIZES[pageSetup.pageSize] ?? PAGE_SIZES[FALLBACK_PAGE_SIZE];
      const widthPt = pageSetup.customWidth ?? preset.width;
      const heightPt = pageSetup.customHeight ?? preset.height;
      setDraft({ width: formatPt(widthPt, unit), height: formatPt(heightPt, unit) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleUnitChange(next: MeasurementUnit) {
    setDraft((d) => {
      const wPt = parseUnitToPt(d.width, unit);
      const hPt = parseUnitToPt(d.height, unit);
      return {
        width: wPt != null ? formatPt(wPt, next) : d.width,
        height: hPt != null ? formatPt(hPt, next) : d.height,
      };
    });
    setMeasurementUnit(next);
  }

  function handleDone() {
    const wPt = parseUnitToPt(draft.width, unit);
    const hPt = parseUnitToPt(draft.height, unit);
    if (
      wPt != null && hPt != null &&
      wPt >= MIN_PT && wPt <= MAX_PT &&
      hPt >= MIN_PT && hPt <= MAX_PT
    ) {
      const preset = findMatchingPreset(wPt, hPt);
      if (preset) {
        setPageSetup({ ...pageSetup, pageSize: preset });
      } else {
        setPageSetup({ ...pageSetup, pageSize: 'custom', customWidth: wPt, customHeight: hPt });
      }
    }
    closeCustomSize();
  }

  const suffix = MEASUREMENT_UNITS[unit].suffix;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeCustomSize(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custom Page Size</DialogTitle>
          <DialogDescription>
            Page dimensions in {MEASUREMENT_UNITS[unit].label.toLowerCase()}. Changes apply when you select Done.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-14 text-muted-foreground">Width</span>
            <Input
              type="number"
              min={0}
              step={0.25}
              className="h-8"
              aria-label="Page width"
              value={draft.width}
              onChange={(e) => setDraft((d) => ({ ...d, width: e.target.value }))}
            />
            <span className="w-4 text-xs text-muted-foreground">{suffix}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="w-14 text-muted-foreground">Height</span>
            <Input
              type="number"
              min={0}
              step={0.25}
              className="h-8"
              aria-label="Page height"
              value={draft.height}
              onChange={(e) => setDraft((d) => ({ ...d, height: e.target.value }))}
            />
            <span className="w-4 text-xs text-muted-foreground">{suffix}</span>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Units</span>
          <Select value={unit} onValueChange={(v) => { if (v != null) handleUnitChange(v); }}>
            <SelectTrigger className="h-8 w-40 text-sm" aria-label="Measurement units">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MEASUREMENT_UNITS).map(([key, meta]) => (
                <SelectItem key={key} value={key}>{meta.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={closeCustomSize}>Cancel</Button>
          <Button size="sm" onClick={handleDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
