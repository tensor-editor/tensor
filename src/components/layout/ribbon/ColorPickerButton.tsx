import { useState } from 'react';
import { ChevronDown, Pencil, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconButton } from '../IconButton';
import { COLOR_ROWS, GRAYSCALE_ROW } from '@/lib/colorPalette';
import { useConfigStore } from '@/lib/config/store';
import { formatColor } from '@/lib/colorFormat';
import { ColorPicker } from '../../ui/color-picker';

interface ColorPickerButtonProps {
  label: string;
  icon?: React.ReactNode;
  defaultColor?: string;
  resetLabel?: string;
  onChange: (color: string | null) => void;
  shortcutId?: string;
  /** Main button renders as a SOLID swatch of the active color and opens
   * the palette (no apply-last-picked behavior). An unset/empty color
   * shows the theme primary at reduced opacity. */
  solidSwatch?: boolean;
  /** Suppresses the reset/none button at the top of the palette. */
  hideReset?: boolean;
  /** Color the trigger swatch shows after reset (e.g. '#ffffff' when
   * "default" means white paper). Unset = transparent/absent swatch. */
  resetColor?: string;
}

export function ColorPickerButton({
  label,
  icon,
  defaultColor = '#000000',
  resetLabel = 'None',
  onChange,
  shortcutId,
  solidSwatch = false,
  hideReset = false,
  resetColor,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [lastPicked, setLastPicked] = useState<string | null>(defaultColor);
  const [removeMode, setRemoveMode] = useState(false);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);

  const displayFormat = useConfigStore((s) => s.config.editor.colorDisplayFormat);
  const savedCustomColors = useConfigStore((s) => s.config.editor.customColors);
  const addCustomColor = useConfigStore((s) => s.addCustomColor);
  const removeCustomColor = useConfigStore((s) => s.removeCustomColor);

  function pick(color: string | null) {
    setLastPicked(color ?? resetColor ?? null);
    onChange(color);
    setOpen(false);
  }

  function renderSwatch(color: string) {
    return (
      <Tooltip key={color}>
        <TooltipTrigger
          render={
            <button
              className="h-6 w-6 rounded border border-border"
              style={{ backgroundColor: color }}
              onClick={() => pick(color)}
              aria-label={formatColor(color, displayFormat)}
            />
          }
        />
        <TooltipContent>{formatColor(color, displayFormat)}</TooltipContent>
      </Tooltip>
    );
  }

  function renderSavedSwatch(color: string) {
    if (!removeMode) return renderSwatch(color);

    return (
      <Tooltip key={color}>
        <TooltipTrigger
          render={
            <button
              className="group relative h-6 w-6 overflow-hidden rounded border border-border"
              style={{ backgroundColor: color }}
              onClick={() => removeCustomColor(color)}
            >
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 backdrop-blur-[1px] transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
                <Trash2 size={11} className="text-white" />
              </div>
            </button>
          }
        />
        <TooltipContent>Remove {formatColor(color, displayFormat)}</TooltipContent>
      </Tooltip>
    );
  }

  const mainIcon = solidSwatch ? (
    <div
      className="h-4 w-4 rounded-[3px] border border-border/60"
      style={{
        backgroundColor: lastPicked || 'var(--primary)',
        opacity: lastPicked ? 1 : 0.45,
      }}
    />
  ) : (
    <div className="flex flex-col items-center">
      {icon}
      <div
        className="h-0.75 w-4 rounded-sm border border-border/50"
        style={{ backgroundColor: lastPicked ?? 'transparent' }}
      />
    </div>
  );

  return (
    <div className="flex items-stretch">
      <IconButton
        label={label}
        icon={mainIcon}
        onClick={solidSwatch ? () => setOpen(true) : () => onChange(lastPicked)}
        shortcutId={shortcutId}
      />

      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setRemoveMode(false); }}>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-xs" className="h-8 w-4 rounded-none" aria-label={`${label} options`}>
              <ChevronDown size={10} />
            </Button>
          }
        />
        <PopoverContent className="w-auto p-2">
          <div className="flex flex-col gap-1">
            {!hideReset && (
              <button
                className="flex h-7 items-center justify-center rounded border border-border text-xs text-muted-foreground hover:bg-muted"
                onClick={() => pick(null)}
              >
                {resetLabel}
              </button>
            )}

            <span className="text-[11px] text-muted-foreground">Preset Colors</span>
            <div className="flex gap-1">{GRAYSCALE_ROW.map(renderSwatch)}</div>

            <div className="grid grid-cols-7 gap-1">
              {COLOR_ROWS.flatMap((row) => row.map(renderSwatch))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Custom Colors</span>
              {savedCustomColors.length > 0 && (
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setRemoveMode((v) => !v)}
                >
                  {removeMode ? <Check size={11} /> : <Pencil size={11} />}
                  {removeMode ? 'Done' : 'Edit'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {savedCustomColors.map(renderSavedSwatch)}

              {!removeMode && (
                <Popover open={customPickerOpen} onOpenChange={setCustomPickerOpen}>
                  <PopoverTrigger
                    render={
                      <button className="flex h-6 w-6 items-center justify-center rounded border border-dashed border-border text-muted-foreground hover:bg-muted">
                        +
                      </button>
                    }
                  />
                  <PopoverContent className="w-48 p-2">
                    <ColorPicker
                      onConfirm={(color) => {
                        addCustomColor(color);
                        setCustomPickerOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
