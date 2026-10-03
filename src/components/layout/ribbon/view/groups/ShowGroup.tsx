import { Ruler, PanelTop, Droplet, Superscript, SquareDashed, MessageSquareText } from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { IconButton } from '../../../IconButton';
import { useConfigStore } from '@/lib/config/store';

export function ShowGroup() {
  // M-IMAGES-1: the Captions DISPLAY toggle (the NPC precedent) —
  // presentation-only ink, both modes; the model (and ToF's caption
  // reads) is untouched.
  const showCaptions = useConfigStore((s) => s.config.editor.showCaptions);
  const setShowCaptions = useConfigStore((s) => s.setShowCaptions);

  return (
    <RibbonGroup>
      <IconButton
        label="Show Captions"
        icon={<MessageSquareText size={16} />}
        active={showCaptions}
        onClick={() => setShowCaptions(!showCaptions)}
      />
      <IconButton
        label="Show Ruler"
        icon={<Ruler size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Show Margins"
        icon={<SquareDashed size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Show Headers & Footers"
        icon={<PanelTop size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Show Watermark"
        icon={<Droplet size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Show Footnotes & Endnotes"
        icon={<Superscript size={16} />}
        onClick={() => {}}
        disabled
      />
    </RibbonGroup>
  );
}
