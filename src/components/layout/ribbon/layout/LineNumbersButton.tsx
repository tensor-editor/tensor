import { useState } from 'react';
import { ChevronDown, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/lib/document/store';
import type { LineNumbersSetting } from '@/lib/document/schema';

type LineNumberMode = LineNumbersSetting['mode'];

/** The list-style dropdown's menu shape — sample glyphs ride the
 *  right side in muted ink (ListStyleButton precedent). */
const MODES: { value: LineNumberMode; label: string; sample: string }[] = [
  { value: 'per-page', label: 'Per Page', sample: '1/p' },
  { value: 'continuous', label: 'Continuous', sample: '1 2 3' },
  { value: 'per-paragraph', label: 'Per Paragraph', sample: '1/¶' },
];

/**
 * M-LINENUMS — the Layout tab's Line Numbers split button. Main icon
 * toggles the gutter; the chevron opens the mode menu (ListStyleButton
 * pattern: icon + slim right-side chevron). Reflects + writes the
 * CURRENT DOCUMENT's metadata — enabling defaults to Per Page;
 * choosing a mode enables with that mode.
 */
export function LineNumbersButton() {
  const lineNumbers = useDocumentStore((s) => s.lineNumbers);
  const [open, setOpen] = useState(false);
  const enabled = lineNumbers?.enabled ?? false;
  const mode: LineNumberMode = lineNumbers?.mode ?? 'per-page';

  function write(next: LineNumbersSetting) {
    useDocumentStore.getState().setLineNumbers(next);
  }

  return (
    <div className="flex items-stretch">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={enabled ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="h-8 rounded-r-none"
              aria-pressed={enabled}
              onClick={() => {
                write({ enabled: !enabled, mode, countBy: lineNumbers?.countBy });
              }}
            >
              <ListOrdered size={16} />
            </Button>
          }
        />
        <TooltipContent>Line Numbers</TooltipContent>
      </Tooltip>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-xs" className="h-8 w-4 rounded-l-none" aria-label="Line Numbering Mode">
              <ChevronDown size={10} />
            </Button>
          }
        />
        <PopoverContent className="w-44 p-1">
          <div className="flex flex-col gap-0.5">
            {MODES.map((opt) => (
              <button
                key={opt.value}
                className={`flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted ${
                  enabled && opt.value === mode ? 'bg-muted font-medium' : ''
                }`}
                onClick={() => {
                  write({ enabled: true, mode: opt.value, countBy: lineNumbers?.countBy });
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                <span className="text-muted-foreground">{opt.sample}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
