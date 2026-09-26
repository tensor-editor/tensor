import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDocumentStore } from '../document/store';
import { useConfigStore } from '../config/store';
import { pasteFromSystemClipboard } from '@/lib/editor/clipboard';

export function useMenuEvents() {
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      const id = event.payload;
      const doc = useDocumentStore.getState();

      switch (id) {
        case 'menu-open':
          doc.openFile();
          break;
        case 'menu-save':
          doc.save();
          break;
        case 'menu-save-as':
          doc.saveAs();
          break;
        case 'menu-undo':
          doc.editor?.commands.undo();
          break;
        case 'menu-redo':
          doc.editor?.commands.redo();
          break;
        case 'menu-cut':
          document.execCommand('cut');
          break;
        case 'menu-copy':
          document.execCommand('copy');
          break;
        case 'menu-paste':
          if (doc.editor) void pasteFromSystemClipboard(doc.editor);
          break;
        case 'menu-toggle-dark-mode': {
          const { config, setTheme } = useConfigStore.getState();
          setTheme(config.theme === 'dark' ? 'light' : 'dark');
          break;
        }
        case 'menu-quit':
          getCurrentWindow().close();
          break;
        case 'menu-new':
          // no "new document" concept exists yet — noted as a gap
          // earlier; leaving as a no-op stub for now.
          console.warn('New Document not yet implemented');
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
