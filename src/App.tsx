import { useEffect } from 'react';
import { Editor } from './components/editor/Editor';
import { SearchPanel } from './components/editor/SearchPanel';
import { SearchResultsSidebar } from './components/editor/SearchResultsSidebar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { DocumentPropertiesDialog } from './components/dialogs/DocumentPropertiesDialog';
import { useConfigStore } from './lib/config/store';
import { useConfigPersistence } from './lib/config/useConfigPersistence';
import './index.css';
import { useAppShortcuts } from './lib/shortcuts/useAppShortcuts';
import { useAutosave } from './lib/document/useAutosave';
import { useMenuEvents } from './lib/menu/useMenuEvents';
import { StatusBar } from './components/layout/StatusBar';
import { Ribbon } from './components/layout/Ribbon';
import { SidebarHost } from './lib/layout/sidebar/SidebarHost';

function App() {
  useConfigPersistence();
  useAutosave();
  useMenuEvents();
  useAppShortcuts();

  const theme = useConfigStore((s) => s.config.theme);

  // Applied to <html>, not a wrapper div — Base UI's Portal-based
  // components (Dialog, DropdownMenu, Popover, Tooltip) render their
  // actual content as a direct child of <body>, outside any wrapper div
  // in this component tree. The Tailwind `dark` variant only matches
  // .dark or *actual DOM descendants* of .dark — a wrapper div's class
  // has zero effect on portaled content sitting outside it, causing it
  // to silently fall back to light-mode tokens with no error. <html> is
  // an ancestor of literally everything, portaled or not.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <>
      <main className="flex h-screen flex-col bg-background text-foreground">
        <Ribbon />
        <div className="relative flex-1 overflow-hidden">
          <div className="absolute inset-0 overflow-auto pt-6">
            <Editor />
          </div>
          <SearchPanel />
          <SidebarHost id="search" anchor="right">
            <SearchResultsSidebar />
          </SidebarHost>
        </div>
        <StatusBar />
      </main>
      <SettingsDialog />
      <DocumentPropertiesDialog />
    </>
  );
}

export default App;
