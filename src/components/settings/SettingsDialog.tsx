import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { SETTINGS_PANELS } from '@/lib/settings/panels';
import { useActiveSection } from '@/lib/settings/useActiveSection';
import { useReducedMotion } from '@/lib/accessibility/useReducedMotion';
import { revealConfigFile } from '@/lib/config/persistence';
import { cn } from 'cn';

export function SettingsDialog() {
  const isOpen = useSettingsDialogStore((s) => s.isOpen);
  const activePanelId = useSettingsDialogStore((s) => s.activePanelId);
  const close = useSettingsDialogStore((s) => s.close);
  const setActivePanel = useSettingsDialogStore((s) => s.setActivePanel);

  const activePanel = SETTINGS_PANELS.find((p) => p.id === activePanelId) ?? SETTINGS_PANELS[0];
  const ActiveComponent = activePanel.component;
  const sectionIds = activePanel.sections?.map((s) => s.id) ?? [];

  const contentRef = useRef<HTMLDivElement>(null);
  const pendingScrollSectionId = useRef<string | null>(null);
  const reduceMotion = useReducedMotion();
  const [revealError, setRevealError] = useState<string | null>(null);

  const activeSectionId = useActiveSection(contentRef, sectionIds);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activePanelId]);

  useEffect(() => {
    if (!pendingScrollSectionId.current) return;
    const id = pendingScrollSectionId.current;
    pendingScrollSectionId.current = null;
    requestAnimationFrame(() => scrollToSection(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanelId]);

  function scrollToSection(sectionId: string) {
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
    el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function handleSelectSection(panelId: string, sectionId: string) {
    if (panelId !== activePanelId) {
      pendingScrollSectionId.current = sectionId;
      setActivePanel(panelId);
    } else {
      scrollToSection(sectionId);
    }
  }

  const handleRevealConfig = async () => {
    setRevealError(null);
    try {
      await revealConfigFile();
    } catch (err) {
      console.error('Failed to reveal config file:', err);
      setRevealError('Could not open file manager.');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent showCloseButton style={{ width: 'min(85vw, 72rem)', maxWidth: 'min(85vw, 72rem)' }}>
        <DialogDescription className="sr-only">Application settings</DialogDescription>

        <div className="-m-4 flex flex-col overflow-hidden rounded-xl" style={{ height: 'min(80vh, 46rem)' }}>
          <div className="flex-none border-b border-border px-4 py-3 pr-10">
            <DialogTitle className="font-heading text-base font-semibold">Application Settings</DialogTitle>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <nav className="flex w-56 flex-none flex-col border-r border-border bg-muted/30">
              <div className="flex-1 overflow-y-auto p-2">
                {SETTINGS_PANELS.map((panel) => {
                  const isPanelActive = panel.id === activePanel.id;
                  return (
                    <div key={panel.id} className="mb-1">
                      <button
                        type="button"
                        onClick={() => setActivePanel(panel.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                          isPanelActive
                            ? 'bg-secondary text-secondary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <panel.icon className="h-4 w-4" />
                        {panel.label}
                      </button>

                      {isPanelActive && panel.sections && panel.sections.length > 1 && (
                        <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3">
                          {panel.sections.map((section) => (
                            <button
                              key={section.id}
                              type="button"
                              onClick={() => handleSelectSection(panel.id, section.id)}
                              className={cn(
                                'rounded px-2 py-1 text-left text-xs',
                                section.id === activeSectionId
                                  ? 'font-medium text-foreground'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {section.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Persistent footer, always reachable regardless of which
                  panel is active — not really a "setting" so it lives in
                  the nav rail itself rather than inside any one panel. */}
              <div className="flex-none border-t border-border p-2">
                <button
                  type="button"
                  onClick={handleRevealConfig}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <FolderOpen className="h-4 w-4" />
                  Configuration File
                </button>
                {revealError && <div className="px-2 pt-1 text-xs text-destructive">{revealError}</div>}
              </div>
            </nav>

            <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
              <h2 className="mb-4 text-lg font-semibold">{activePanel.label}</h2>
              <ActiveComponent />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
