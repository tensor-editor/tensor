import { Pilcrow } from 'lucide-react';
import { IconButton } from '../../IconButton';
import { useConfigStore } from '@/lib/config/store';

export function NonPrintingCharsToggle() {
  const enabled = useConfigStore((s) => s.config.editor.showNonPrintingChars);
  const setShowNonPrintingChars = useConfigStore((s) => s.setShowNonPrintingChars);

  function toggle() {
    setShowNonPrintingChars(!enabled);
  }

  return (
    <IconButton
      label="Show Non-Printing Characters"
      icon={<Pilcrow size={16} />}
      active={enabled}
      onClick={toggle}
    />
  );
}
