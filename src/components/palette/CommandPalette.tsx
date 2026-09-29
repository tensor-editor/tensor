import { usePaletteStore } from '@/lib/palette/store';
import { useAppCommands } from '@/lib/commands/useAppCommands';
import type { CommandAction, CommandGroup as CommandGroupKind } from '@/lib/commands/registry';
import { useShortcutDisplay } from '@/lib/useShortcutDisplay';
import { formatShortcutParts } from '@/lib/shortcuts';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';

/**
 * M-PALETTE. Pure chrome over the command registry — never an editor
 * surface: it reads nothing from ProseMirror and writes nothing to it,
 * so opening it can't move the selection or scroll the document. The
 * PM selection stays intact for the whole overlay lifetime; closing
 * (palette store) refocuses the editor and the caret comes back where
 * it was.
 */

const GROUP_ORDER: { group: CommandGroupKind; heading: string }[] = [
  { group: 'actions', heading: 'Actions' },
  { group: 'format', heading: 'Format' },
  { group: 'navigate', heading: 'Navigate' },
];

/** The user's LIVE binding for a command's shortcut — pulled from
 *  config via getEffectiveKeybinding, so a rebind made in Settings is
 *  what the hint shows (and updates live). */
function ShortcutHint({ shortcutId }: { shortcutId: string }) {
  const binding = useShortcutDisplay(shortcutId);
  if (!binding) return null;
  return (
    <CommandShortcut data-testid={`palette-hint-${shortcutId}`}>
      <KbdGroup>
        {formatShortcutParts(binding).map((part) => (
          <Kbd key={part}>{part}</Kbd>
        ))}
      </KbdGroup>
    </CommandShortcut>
  );
}

function PaletteItem({ command, onRun }: { command: CommandAction; onRun: (c: CommandAction) => void }) {
  const Icon = command.icon;
  return (
    <CommandItem
      data-testid={`palette-item-${command.id}`}
      value={`${command.title} ${command.keywords.join(' ')}`}
      onSelect={() => onRun(command)}
    >
      {Icon ? <Icon /> : null}
      <span>{command.title}</span>
      {command.shortcutId ? <ShortcutHint shortcutId={command.shortcutId} /> : null}
    </CommandItem>
  );
}

export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const editorContext = usePaletteStore((s) => s.editorContext);
  const commands = useAppCommands(editorContext);

  // Close FIRST, then run: close() refocuses the editor while the
  // selection is still intact (editor commands apply to it), and any
  // dialog the command opens (settings, properties...) takes focus
  // after — never fighting the palette for it.
  const runCommand = (command: CommandAction) => {
    usePaletteStore.getState().close();
    void command.run();
  };

  return (
    <CommandDialog
      title="Command Palette"
      description="Search for a command to run..."
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) usePaletteStore.getState().close();
      }}
      className="sm:max-w-lg"
    >
      <Command>
        <CommandInput data-testid="palette-input" placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No matching commands.</CommandEmpty>
          {GROUP_ORDER.map(({ group, heading }) => {
            const items = commands.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <CommandGroup key={group} heading={heading}>
                {items.map((command) => (
                  <PaletteItem key={command.id} command={command} onRun={runCommand} />
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
      <div
        data-testid="palette-footer"
        className="border-t px-3 py-2 text-center text-xs text-muted-foreground"
      >
        ↑↓ navigate · ↵ run · esc close
      </div>
    </CommandDialog>
  );
}
