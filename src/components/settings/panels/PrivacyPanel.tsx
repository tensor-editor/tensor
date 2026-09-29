import type { ReactNode } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { useConfigStore } from '@/lib/config/store';
import { Switch } from '@/components/ui/switch';
import { IconButton } from '@/components/layout/IconButton';
import { SettingsSection } from '@/components/settings/SettingsSection';
import type { SettingsSectionDefinition } from '@/lib/settings/types';

export const PRIVACY_PANEL_SECTIONS: SettingsSectionDefinition[] = [
  { id: 'link-previews', label: 'Link Previews' },
  { id: 'updates', label: 'Updates' },
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

export function PrivacyPanel() {
  const fetchLinkMetadata = useConfigStore((s) => s.config.privacy.fetchLinkMetadata);
  const setFetchLinkMetadata = useConfigStore((s) => s.setFetchLinkMetadata);
  const autoCheckForUpdates = useConfigStore((s) => s.config.privacy.autoCheckForUpdates);
  const setAutoCheckForUpdates = useConfigStore((s) => s.setAutoCheckForUpdates);

  return (
    <div className="flex flex-col">
      <SettingsSection id="link-previews" title="Link Previews">
        <Row
          icon={<Link2 className="h-4 w-4" />}
          label="Fetch Link Preview Metadata"
          description="When inserting a hyperlink, fetch the page's title/favicon from the internet to show a live preview. Disabling this means links are never followed until you click them."
        >
          <Switch checked={fetchLinkMetadata} onCheckedChange={setFetchLinkMetadata} />
        </Row>
      </SettingsSection>

      <SettingsSection id="updates" title="Updates">
        <Row
          icon={<RefreshCw className="h-4 w-4" />}
          label="Automatically Check for Updates"
          description="Periodically contacts GitHub Releases to check for a newer version. Not yet implemented (tracked in #65) — this only saves your preference for when it is."
        >
          <Switch checked={autoCheckForUpdates} onCheckedChange={setAutoCheckForUpdates} />
        </Row>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">Check Now</div>
            <div className="text-xs text-muted-foreground">Not yet implemented — requires a signed release pipeline (#65)</div>
          </div>
          <span className="inline-flex">
            <IconButton
              label="Check for updates — not yet implemented"
              icon={<RefreshCw className="h-4 w-4" />}
              disabled
              onClick={() => {}}
            />
          </span>
        </div>
      </SettingsSection>
    </div>
  );
}
