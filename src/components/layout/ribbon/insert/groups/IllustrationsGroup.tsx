import { Table, Image as ImageIcon, PaintbrushVertical } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { RibbonGroup } from '@/components/layout/RibbonGroup';
import { IconButton } from '../../../IconButton';
import { insertImageFromPicker } from '@/lib/media/insert';

export function IllustrationsGroup({ editor }: { editor: Editor }) {
  return (
    <RibbonGroup>
      {/* M-IMAGES-1: the Insert > Image path goes live — OS picker →
          binary read → the ONE insertion pipeline. */}
      <IconButton
        label="Image"
        icon={<ImageIcon size={16} />}
        onClick={() => void insertImageFromPicker(editor)}
      />
      <IconButton
        label="Table"
        icon={<Table size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Drawing"
        icon={<PaintbrushVertical size={16} />}
        onClick={() => { }}
        disabled
        />
    </RibbonGroup>
  );
}
