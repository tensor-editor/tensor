import { ZoomIn, ZoomOut } from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { IconButton } from '../../../IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfigStore } from '@/lib/config/store';

const ZOOM_STEP = 10;
const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200];

export function ZoomGroup() {
  const zoom = useConfigStore((s) => s.config.editor.zoomLevel);
  const setZoom = useConfigStore((s) => s.setZoomLevel);

  return (
    <RibbonGroup>
      <IconButton
        label="Zoom Out"
        icon={<ZoomOut size={16} />}
        onClick={() => setZoom(zoom - ZOOM_STEP)}
      />

      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button variant="ghost" size="sm" className="h-8 w-16 text-sm">
                    {zoom}%
                  </Button>
                }
              />
            }
          />
          <TooltipContent>Zoom Level</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-32 p-1">
          <div className="flex flex-col gap-0.5">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset}
                className="rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => setZoom(preset)}
              >
                {preset}%
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <IconButton
        label="Zoom In"
        icon={<ZoomIn size={16} />}
        onClick={() => setZoom(zoom + ZOOM_STEP)}
      />
    </RibbonGroup>
  );
}
