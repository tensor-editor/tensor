import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useShortcutDisplay } from '@/lib/useShortcutDisplay';
import { formatShortcutParts } from '@/lib/shortcuts';

interface IconButtonProps extends React.ComponentProps<'button'> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcutId?: string;
}

export function IconButton({ label, icon, active, disabled, onClick, shortcutId, ...rest }: IconButtonProps) {
  const shortcut = useShortcutDisplay(shortcutId ?? '');

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex">
            <Button
              variant={active ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
              {...rest}
              // `active` marks every current use a toggle state (bold,
              // alignment, mode, ...) — announce it to AT.
              {...(active !== undefined ? { 'aria-pressed': active } : {})}
            >
              {icon}
            </Button>
          </span>
        }
      />
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <KbdGroup>
            {formatShortcutParts(shortcut).map((part, i) => (
              <Kbd key={i}>{part}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
