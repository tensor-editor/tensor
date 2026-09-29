import { FileStack, Maximize, BookOpen, ScrollText } from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { IconButton } from '../../../IconButton';
import { useConfigStore } from '@/lib/config/store';

/** View > Display Mode: the Paginated/Pageless toggle — the ONE switch
 * for the editor's rendering mode (config.editor.defaultPageLayout,
 * the same value the Editor's mode-routing seam reads; the Settings
 * write path and this button share the store setter). Paginated is
 * Tensor's default and identity: the button shows ACTIVE when
 * paginated, like GDocs' Print Layout toggle. */
export function DisplayModeGroup() {
  const mode = useConfigStore((s) => s.config.editor.defaultPageLayout);
  const setMode = useConfigStore((s) => s.setDefaultPageLayout);
  const isPaginated = mode === 'Pages';

  return (
    <RibbonGroup>
      <IconButton
        label="Paginated / Pageless"
        icon={isPaginated ? <FileStack size={16} /> : <ScrollText size={16} />}
        active={isPaginated}
        onClick={() => setMode(isPaginated ? 'Pageless' : 'Pages')}
      />
      <IconButton
        label="Focus Mode"
        icon={<Maximize size={16} />}
        onClick={() => {}}
        disabled
      />
      <IconButton
        label="Reading Mode"
        icon={<BookOpen size={16} />}
        onClick={() => {}}
        disabled
      />
    </RibbonGroup>
  );
}
