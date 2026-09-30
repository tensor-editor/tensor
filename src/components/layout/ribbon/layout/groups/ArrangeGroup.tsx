import { Columns2 } from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { IconButton } from '../../../IconButton';
import { LineNumbersButton } from '../LineNumbersButton';

export function ArrangeGroup() {
  return (
    <RibbonGroup showSeparator={false}>
      <IconButton label="Columns" icon={<Columns2 size={16} />} onClick={() => {}} disabled />
      <LineNumbersButton />
    </RibbonGroup>
  );
}
