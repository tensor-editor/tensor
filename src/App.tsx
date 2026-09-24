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
import { useDocumentStore } from './lib/document/store';

function App() {
  useConfigPersistence();
  useAutosave();
  useMenuEvents();
  useAppShortcuts();

  // M5.8 differential benchmark. Triggers: URL #bench/?bench, OR five
  // rapid clicks on the StatusBar (mouse-only driving — the test box's
  // keyboard injection is unreliable). Output goes to a visible <pre>
  // (readable via AT-SPI from the WebKitGTK app) + console.
  useEffect(() => {
    const mark = (s: string) => {
      document.title = s.slice(0, 150);
    };
    // M5.8 measurement channel: write results into $APPDATA via the fs
    // plugin — readable from the shell regardless of a11y/console/title.
    const writeResult = async (text: string, suffix = '') => {
      try {
        const [{ writeTextFile }, { appDataDir, join }] = await Promise.all([
          import('@tauri-apps/plugin-fs'),
          import('@tauri-apps/api/path'),
        ]);
        await writeTextFile(await join(await appDataDir(), `bench-result${suffix}.txt`), text);
      } catch {
        // non-Tauri (plain browser) — console + <pre> still carry it
      }
    };
    const runDifferential = async () => {
      try {
        mark('BENCH:starting');
        const editor = useDocumentStore.getState().editor;
        if (!editor) {
          mark('BENCH:no-editor');
          return;
        }
        mark('BENCH:loading-modules');
        const [{ runBench: rb, formatBench: fb }, { default: perf71 }] = await Promise.all([
          import('@/lib/paginated/bench'),
          import('@/tests/fixtures/perf-71.html?raw'),
        ]);
        mark('BENCH:small-start');
        const small = await rb(editor, '<p>hello world</p>', 'SMALL');
        await writeResult('=== SMALL ===\n' + fb(small), '-small');
        mark('BENCH:big-start');
        const big = await rb(editor, perf71, 'BIG');
        // Global for browser drivers (Brave/Chromium collect via CDP).
        (globalThis as { __benchResult?: unknown }).__benchResult = { small, big };
        const text =
          '=== M5.10 DIFFERENTIAL ===\n' + fb(small) + '\n' + fb(big);
        await writeResult(text);
        // eslint-disable-next-line no-console
        console.log(text);
        document.getElementById('bench-output')?.remove();
        const pre = document.createElement('pre');
        pre.id = 'bench-output';
        pre.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#fff;color:#000;padding:8px;font-size:11px;max-height:420px;overflow:auto;white-space:pre-wrap;font-family:monospace';
        pre.textContent = text;
        document.body.appendChild(pre);
        // Title channel: the whole result, newline-free, for AT-SPI.
        mark('BENCH-RESULT | ' + text.split('\n').join(' | '));
      } catch (err) {
        mark('BENCH:ERROR ' + (err instanceof Error ? err.message : String(err)).slice(0, 120));
      }
    };
    const armed = () => useDocumentStore.getState().editor !== null;
    const urlTriggered =
      location.hash === '#bench' || new URLSearchParams(location.search).has('bench');
    if (urlTriggered || __BENCH_AUTO__) {
      const poll = () => (armed() ? void runDifferential() : setTimeout(poll, 250));
      poll();
    }
    const onBenchEvent = () => {
      if (armed()) void runDifferential();
      else setTimeout(onBenchEvent, 250);
    };
    window.addEventListener('tensor-bench', onBenchEvent, { once: true });
    return () => window.removeEventListener('tensor-bench', onBenchEvent);
  }, []);

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
          {/* M4.1 desk: the editor scroll surface — the muted token reads
              as the classic gray desk in light mode and adapts in dark. */}
          <div className="absolute inset-0 overflow-auto bg-muted pt-6">
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
