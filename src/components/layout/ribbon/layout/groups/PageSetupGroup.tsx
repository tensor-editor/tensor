import { RulerDimensionLine, RectangleHorizontal, RectangleVertical, PaintBucket, Proportions } from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { IconButton } from '../../../IconButton';
import { ColorPickerButton } from '../../ColorPickerButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/lib/document/store';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { PAGE_SIZES } from '@/lib/document/pageSetup';

/**
 * Layout tab > Page Setup (M5.13): paper size (with custom), orientation,
 * page background, and margins — all writing useDocumentStore.setPageSetup,
 * which persists via .wpdoc metadata and reflows the document
 * immediately (L4: pageSetup is read per layout call).
 *
 * Selecting "Custom…" only opens the CustomPageSizeDialog — the
 * document changes when the user confirms in the dialog (Done), not
 * at dropdown-selection time.
 */
export function PageSetupGroup() {
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const setPageSetup = useDocumentStore((s) => s.setPageSetup);
  const isLandscape = pageSetup.orientation === 'landscape';

  function handlePageSizeChange(value: string) {
    if (value === 'custom') {
      useDocumentPropertiesStore.getState().openCustomSize();
      return;
    }
    setPageSetup({ ...pageSetup, pageSize: value });
  }

  return (
    <RibbonGroup>
      <IconButton
        label="Margins"
        icon={<RulerDimensionLine size={16} />}
        onClick={() => useDocumentPropertiesStore.getState().openMargins()}
        disabled
      />

      <IconButton
        label="Orientation"
        icon={isLandscape ? <RectangleHorizontal size={16} /> : <RectangleVertical size={16} />}
        onClick={() =>
          setPageSetup({ ...pageSetup, orientation: isLandscape ? 'portrait' : 'landscape' })
        }
      />

      <Tooltip>
        <TooltipTrigger
          render={
            <Select
              value={pageSetup.pageSize}
              onValueChange={(value) => {
                if (value != null) handlePageSizeChange(value);
              }}
            >
              <SelectTrigger className="mx-1.5 h-8 w-32 gap-1.5 text-sm">
                <Proportions size={14} className="shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Paper Size" />
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                className="w-64"
                >
                {Object.entries(PAGE_SIZES).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    {key} <span className="text-muted-foreground">({preset.inches})</span>
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <TooltipContent>Paper Size</TooltipContent>
      </Tooltip>

      <ColorPickerButton
        label="Page Background"
        icon={<PaintBucket size={16} />}
        resetLabel="Default"
        resetColor="#ffffff"
        defaultColor={pageSetup.pageColor || '#ffffff'}
        onChange={(color) => setPageSetup({ ...pageSetup, pageColor: color ?? '' })}
      />
    </RibbonGroup>
  );
}
