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
  MARGIN_PRESETS,
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

function draftMatches(draft: Record<MarginKey, string>, preset: Margins, unit: MeasurementUnit): boolean {
  return FIELDS.every(({ key }) => draft[key] === formatPt(preset[key], unit));
}

/**
 * Layout > Margins — the margins entrance (M6 ruling). COMMIT-GATED:
 * presets and custom fields edit a DRAFT only; nothing writes the
 * document until Apply, and Apply performs exactly ONE
 * useDocumentStore.setPageSetup call → one reflow. Values are stored
 * in POINTS (the store's canonical unit — presets land at Word's
 * physical sizes in engine px, 96/72 px/pt; the table lives in
 * pageSetup.ts's MARGIN_PRESETS). Inputs display in the user's
 * measurement unit (config.editor.measurementUnit); persistence is
 * free via .wpdoc metadata.
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

  // Re-sync the draft from the store each time the dialog opens (or
  // the store's margins change underneath it — e.g. a loaded file).
  useEffect(() => {
    if (isOpen) {
      setDraft(snapshot(pageSetup.margins, unit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pageSetup.margins]);

  /** DRAFT ONLY — no store write. The document diverges from the
   * draft until Apply; that is the contract this dialog exists for. */
  function edit(key: MarginKey, raw: string) {
    setDraft((d) => ({ ...d, [key]: raw }));
  }

  function pickPreset(preset: Margins) {
    setDraft(snapshot(preset, unit));
  }

  /** ONE commit → ONE reflow. Invalid fields keep the store's value;
   * 0pt margins are legal (content box meets the sheet edge). */
  function apply() {
    const margins = { ...pageSetup.margins };
    for (const { key } of FIELDS) {
      const pt = parseUnitToPt(draft[key], unit, { allowZero: true });
      if (pt != null && pt >= 0) margins[key] = pt;
    }
    setPageSetup({ ...pageSetup, margins });
  }

  const suffix = MEASUREMENT_UNITS[unit].suffix;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeMargins(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Margins</DialogTitle>
          <DialogDescription>
            Page margins in {MEASUREMENT_UNITS[unit].label.toLowerCase()}. Changes apply when you
            press Apply and are saved with the document.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            {Object.entries(MARGIN_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                className="rounded px-2 py-1 text-left text-sm hover:bg-muted aria-selected:bg-muted"
                aria-selected={draftMatches(draft, preset.margins, unit)}
                onClick={() => pickPreset(preset.margins)}
              >
                {preset.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {FIELDS.map(({ key: k, label }) =>
                    `${label[0]}: ${formatPt(preset.margins[k], unit)}${suffix}`
                  ).join('  ')}
                </span>
              </button>
            ))}
          </div>

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
                  onChange={(e) => edit(key, e.target.value)}
                />
                <span className="w-4 text-xs text-muted-foreground">{suffix}</span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={apply}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={closeMargins}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
