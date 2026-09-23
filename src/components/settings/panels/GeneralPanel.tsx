import type { ReactNode } from 'react';
import { Moon, Type, Paintbrush, Accessibility as AccessibilityIcon } from 'lucide-react';
import { useConfigStore } from '@/lib/config/store';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ColorPickerButton } from '@/components/layout/ribbon/ColorPickerButton';
import { SettingsSection } from '@/components/settings/SettingsSection';
import type { SettingsSectionDefinition } from '@/lib/settings/types';

export const GENERAL_PANEL_SECTIONS: SettingsSectionDefinition[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'accessibility', label: 'Accessibility' },
];

function Row({ icon, label, description, children }: { icon: ReactNode; label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <div className="text-sm font-medium">{label}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function SelectionColorRow() {
  const selectionColor = useConfigStore((s) => s.config.editor.selectionColor);
  const setSelectionColor = useConfigStore((s) => s.setSelectionColor);

  return (
    <Row
      icon={<Paintbrush className="h-4 w-4" />}
      label="Selection Color"
      description="Background of the painted text selection; always painted translucent so text stays readable"
    >
      {/* The SAME picker the ribbon's text/highlight colors use. */}
      <ColorPickerButton
        label="Selection Color"
        icon={<span className="text-[10px] font-semibold leading-none">ABC</span>}
        defaultColor={selectionColor || '#3b82f6'}
        resetLabel="Theme"
        onChange={(color) => setSelectionColor(color ?? '')}
      />
    </Row>
  );
}

export function GeneralPanel() {
  const theme = useConfigStore((s) => s.config.theme);
  const setTheme = useConfigStore((s) => s.setTheme);
  const useFloatingToolbar = useConfigStore((s) => s.config.useFloatingToolbar);
  const setUseFloatingToolbar = useConfigStore((s) => s.setUseFloatingToolbar);
  const reduceMotion = useConfigStore((s) => s.config.accessibility.reduceMotion);
  const setReduceMotion = useConfigStore((s) => s.setReduceMotion);

  return (
    <div className="flex flex-col">
      <SettingsSection id="appearance" title="Appearance">
        <Row icon={<Moon className="h-4 w-4" />} label="Dark Mode" description="Switch between light and dark appearance">
          <Switch checked={theme === 'dark'} onCheckedChange={(checked: boolean) => setTheme(checked ? 'dark' : 'light')} />
        </Row>
      </SettingsSection>

      <SettingsSection id="editor" title="Editor">
        <Row icon={<Type className="h-4 w-4" />} label="Floating Toolbar" description="Show a formatting toolbar near text selections">
          <Switch checked={useFloatingToolbar} onCheckedChange={setUseFloatingToolbar} />
        </Row>
        <SelectionColorRow />
      </SettingsSection>

      <SettingsSection id="accessibility" title="Accessibility">
        <Row
          icon={<AccessibilityIcon className="h-4 w-4" />}
          label="Reduce Motion"
          description="Disable UI animations (panels, transitions)"
        >
          <div className="flex gap-1">
            {(['system', 'on', 'off'] as const).map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant={reduceMotion === opt ? 'secondary' : 'ghost'}
                onClick={() => setReduceMotion(opt)}
                className="capitalize"
              >
                {opt}
              </Button>
            ))}
          </div>
        </Row>
      </SettingsSection>
    </div>
  );
}
